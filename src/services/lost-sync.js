const ghlService = require('./ghl');

const SYNC_KEY = 'lost_sync_last_at';
const PAGE_LIMIT = 100;
const DEFAULT_MAX_PAGES = 80; // ~8000 opps — safety bound on a full backfill

async function getLastSyncAt(prisma) {
  const row = await prisma.syncState.findUnique({ where: { key: SYNC_KEY } });
  return row && row.value ? new Date(row.value) : null;
}

async function setLastSyncAt(prisma, date) {
  const value = date.toISOString();
  await prisma.syncState.upsert({
    where: { key: SYNC_KEY },
    update: { value },
    create: { key: SYNC_KEY, value },
  });
}

// Register a newly-seen GHL lost-reason id with a placeholder label (the id).
// Admin renames it at /admin/lost-reasons. GHL has no API to list reasons.
async function ensureReason(prisma, known, ghlId) {
  if (!ghlId || known.has(ghlId)) return;
  await prisma.ghlLostReason.upsert({
    where: { ghlId },
    update: {},
    create: { ghlId, label: ghlId },
  });
  known.add(ghlId);
}

// Pull lost opportunities from GHL into the conversions table.
// Incremental by default: stops once it passes the stored cursor (results are
// newest-first). Pass { fullBackfill: true } to walk the whole history.
async function syncLostOpportunities(prisma, { fullBackfill = false, maxPages = DEFAULT_MAX_PAGES, log = () => {} } = {}) {
  const cursor = fullBackfill ? null : await getLastSyncAt(prisma);

  const users = await prisma.user.findMany({ select: { id: true, ghlUserId: true } });
  const userByGhl = new Map(users.filter((u) => u.ghlUserId).map((u) => [u.ghlUserId, u.id]));
  const known = new Set((await prisma.ghlLostReason.findMany({ select: { ghlId: true } })).map((r) => r.ghlId));

  let startAfter, startAfterId;
  let scanned = 0, upserted = 0, created = 0, newReasons = known.size, pages = 0, newestLostAt = null;

  for (; pages < maxPages; pages++) {
    const res = await ghlService.searchOpportunities({ status: 'lost', limit: PAGE_LIMIT, startAfter, startAfterId });
    if (!res.success) { log(`GHL search failed (${res.status}): ${res.error}`); break; }
    if (!res.opportunities.length) break;

    let reachedCursor = false;
    for (const o of res.opportunities) {
      const lostAt = o.lastStatusChangeAt ? new Date(o.lastStatusChangeAt) : null;
      if (lostAt && (!newestLostAt || lostAt > newestLostAt)) newestLostAt = lostAt;
      if (cursor && lostAt && lostAt <= cursor) { reachedCursor = true; break; }

      scanned++;
      await ensureReason(prisma, known, o.lostReasonId);
      const data = {
        clientName: (o.contact && (o.contact.companyName || o.contact.name)) || o.name || 'Unknown',
        outcome: 'LOST',
        source: 'GHL_SYNC',
        ghlContactId: o.contactId || null,
        ghlOpportunityId: o.id,
        ghlLostReasonId: o.lostReasonId || null,
        ghlAssignedTo: o.assignedTo || null,
        brokerUserId: o.assignedTo ? (userByGhl.get(o.assignedTo) || null) : null,
        lostAt,
      };

      const existing = await prisma.conversion.findFirst({
        where: { ghlOpportunityId: o.id, source: 'GHL_SYNC' },
        select: { id: true },
      });
      if (existing) {
        await prisma.conversion.update({ where: { id: existing.id }, data });
      } else {
        await prisma.conversion.create({ data });
        created++;
      }
      upserted++;
    }

    if (reachedCursor) break;
    if (res.meta && res.meta.startAfterId && res.meta.startAfter != null && res.meta.nextPage) {
      startAfter = res.meta.startAfter;
      startAfterId = res.meta.startAfterId;
    } else break;
  }

  if (newestLostAt) await setLastSyncAt(prisma, newestLostAt);
  newReasons = known.size - newReasons;
  const result = { scanned, upserted, created, newReasons, pages, newestLostAt };
  log(`Lost sync: scanned ${scanned}, upserted ${upserted} (new ${created}), +${newReasons} reasons, ${pages} pages`);
  return result;
}

module.exports = { syncLostOpportunities, getLastSyncAt, SYNC_KEY };
