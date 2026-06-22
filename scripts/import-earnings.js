// Import CBN broker earnings transactions (from parse-cbn-earnings.py) into the
// broker_earnings table. Idempotent: upserts on tranNumber, so re-running with
// fresh monthly exports updates/adds without duplicates.
//
// Usage (in-container):  node scripts/import-earnings.js /tmp/earnings.json
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const zlib = require('zlib');

const prisma = new PrismaClient();

// Accepts plain JSON, base64-JSON, or base64-gzipped-JSON — so the payload can
// be piped in as a compact base64 blob without relying on container shell tools.
function readRows(path) {
  const buf = fs.readFileSync(path);
  if (buf.slice(0, 64).toString('utf8').trimStart().startsWith('[')) {
    return JSON.parse(buf.toString('utf8'));
  }
  let decoded = Buffer.from(buf.toString('utf8').trim(), 'base64');
  if (decoded[0] === 0x1f && decoded[1] === 0x8b) decoded = zlib.gunzipSync(decoded);
  return JSON.parse(decoded.toString('utf8'));
}

function mapRow(r) {
  return {
    brokerName: r.brokerName,
    tranDate: new Date(r.tranDate),
    effectiveDate: r.effectiveDate ? new Date(r.effectiveDate) : null,
    clientName: r.clientName || null,
    tranType: r.tranType || '?',
    invoiceAmount: r.invoiceAmount,
    brokerFee: r.brokerFee,
    brokerCommission: r.brokerCommission,
    grossBrokerIncome: r.grossBrokerIncome,
    netBrokerIncome: r.netBrokerIncome,
    sourceFile: r.sourceFile || null,
  };
}

(async () => {
  const path = process.argv[2];
  if (!path) throw new Error('Usage: node scripts/import-earnings.js <file>  (JSON or base64[-gzip])');
  const rows = readRows(path);
  console.log(`Importing ${rows.length} earnings transactions...`);

  let done = 0;
  for (const r of rows) {
    const data = mapRow(r);
    await prisma.brokerEarning.upsert({
      where: { tranNumber: String(r.tranNumber) },
      update: data,
      create: { tranNumber: String(r.tranNumber), ...data },
    });
    if (++done % 250 === 0) console.log(`  ${done}/${rows.length}`);
  }

  const byBroker = await prisma.brokerEarning.groupBy({
    by: ['brokerName'],
    _sum: { grossBrokerIncome: true },
    _count: true,
  });
  console.log(`Imported ${done} rows. GBI by broker:`);
  for (const b of byBroker.sort((a, c) => Number(c._sum.grossBrokerIncome || 0) - Number(a._sum.grossBrokerIncome || 0))) {
    console.log(`  ${b.brokerName}: $${Math.round(Number(b._sum.grossBrokerIncome || 0)).toLocaleString('en-NZ')} (${b._count} tx)`);
  }
})()
  .catch((e) => { console.error('Import error:', e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
