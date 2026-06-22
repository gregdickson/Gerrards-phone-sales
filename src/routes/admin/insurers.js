const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');

function parsePct(v) {
  const n = parseFloat(String(v ?? '').replace(/[%\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

async function insurerRoutes(fastify) {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', authorize);

  // GET /admin/insurers
  fastify.get('/insurers', async (request, reply) => {
    const insurers = await fastify.prisma.insurer.findMany({ orderBy: { sortOrder: 'asc' } });
    return reply.view('admin/insurers.ejs', {
      pageTitle: 'Insurers',
      user: request.user,
      insurers,
      csrfToken: await reply.generateCsrf(),
      editId: request.query.edit || null,
      errors: {},
    });
  });

  // POST /admin/insurers — create or update
  fastify.post('/insurers', async (request, reply) => {
    const body = request.body;
    const errors = {};
    if (!body.label?.trim()) errors.label = 'Label is required';

    if (Object.keys(errors).length > 0) {
      const insurers = await fastify.prisma.insurer.findMany({ orderBy: { sortOrder: 'asc' } });
      return reply.code(422).view('admin/insurers.ejs', {
        pageTitle: 'Insurers',
        user: request.user,
        insurers,
        csrfToken: await reply.generateCsrf(),
        editId: body.id || null,
        errors,
      });
    }

    const label = body.label.trim();
    const defaultCommissionPct = parsePct(body.default_commission_pct);

    if (body.id) {
      await fastify.prisma.insurer.update({
        where: { id: body.id },
        data: { label, defaultCommissionPct, sortOrder: parseInt(body.sort_order || '0', 10) },
      });
      reply.flash('success', `Insurer "${label}" updated.`);
    } else {
      const maxSort = await fastify.prisma.insurer.aggregate({ _max: { sortOrder: true } });
      await fastify.prisma.insurer.create({
        data: { label, defaultCommissionPct, sortOrder: (maxSort._max.sortOrder || 0) + 1 },
      });
      reply.flash('success', `Insurer "${label}" created.`);
    }

    return reply.redirect('/admin/insurers');
  });

  // POST /admin/insurers/:id — toggle active
  fastify.post('/insurers/:id', async (request, reply) => {
    const insurer = await fastify.prisma.insurer.findUnique({ where: { id: request.params.id } });
    if (!insurer) {
      reply.flash('error', 'Insurer not found.');
      return reply.redirect('/admin/insurers');
    }
    await fastify.prisma.insurer.update({
      where: { id: request.params.id },
      data: { isActive: !insurer.isActive },
    });
    reply.flash('success', `Insurer "${insurer.label}" ${insurer.isActive ? 'deactivated' : 'activated'}.`);
    return reply.redirect('/admin/insurers');
  });
}

module.exports = insurerRoutes;
