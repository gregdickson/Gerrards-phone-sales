const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const { syncLostOpportunities, getLastSyncAt } = require('../../services/lost-sync');

async function lostReasonRoutes(fastify) {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', authorize);

  async function renderPage(request, reply, code = 200) {
    const [reasons, lastSyncAt, lostCount] = await Promise.all([
      fastify.prisma.ghlLostReason.findMany({ orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] }),
      getLastSyncAt(fastify.prisma),
      fastify.prisma.conversion.count({ where: { outcome: 'LOST' } }),
    ]);
    return reply.code(code).view('admin/lost-reasons.ejs', {
      pageTitle: 'Lost Reasons',
      user: request.user,
      reasons,
      lastSyncAt,
      lostCount,
      csrfToken: await reply.generateCsrf(),
      editId: request.query.edit || null,
    });
  }

  // GET /admin/lost-reasons
  fastify.get('/lost-reasons', (request, reply) => renderPage(request, reply));

  // POST /admin/lost-reasons — rename a reason
  fastify.post('/lost-reasons', async (request, reply) => {
    const { id, label } = request.body;
    if (id && label && label.trim()) {
      await fastify.prisma.ghlLostReason.update({ where: { id }, data: { label: label.trim() } });
      reply.flash('success', 'Lost reason label updated.');
    }
    return reply.redirect('/admin/lost-reasons');
  });

  // POST /admin/lost-reasons/sync — run an incremental lost sync now
  fastify.post('/lost-reasons/sync', async (request, reply) => {
    try {
      const r = await syncLostOpportunities(fastify.prisma, { log: (m) => fastify.log.info(m) });
      reply.flash('success', `Synced: ${r.upserted} lost deals (${r.created} new), +${r.newReasons} new reasons.`);
    } catch (err) {
      fastify.log.error({ err }, 'Manual lost sync failed');
      reply.flash('error', `Sync failed: ${err.message}`);
    }
    return reply.redirect('/admin/lost-reasons');
  });
}

module.exports = lostReasonRoutes;
