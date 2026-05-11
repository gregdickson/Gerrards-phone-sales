const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');

async function leadSourceRoutes(fastify) {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', authorize);

  // GET /admin/lead-sources
  fastify.get('/lead-sources', async (request, reply) => {
    const leadSources = await fastify.prisma.leadSource.findMany({
      orderBy: { sortOrder: 'asc' },
    });

    return reply.view('admin/lead-sources.ejs', {
      pageTitle: 'Lead Sources',
      user: request.user,
      leadSources,
      csrfToken: await reply.generateCsrf(),
      editId: request.query.edit || null,
      errors: {},
    });
  });

  // POST /admin/lead-sources — create or update
  fastify.post('/lead-sources', async (request, reply) => {
    const body = request.body;
    const errors = {};

    if (!body.label?.trim()) errors.label = 'Label is required';

    if (Object.keys(errors).length > 0) {
      const leadSources = await fastify.prisma.leadSource.findMany({
        orderBy: { sortOrder: 'asc' },
      });
      return reply.code(422).view('admin/lead-sources.ejs', {
        pageTitle: 'Lead Sources',
        user: request.user,
        leadSources,
        csrfToken: await reply.generateCsrf(),
        editId: body.id || null,
        errors,
      });
    }

    const label = body.label.trim();

    if (body.id) {
      await fastify.prisma.leadSource.update({
        where: { id: body.id },
        data: {
          label,
          sortOrder: parseInt(body.sort_order || '0', 10),
        },
      });
      reply.flash('success', `Lead source "${label}" updated.`);
    } else {
      const maxSort = await fastify.prisma.leadSource.aggregate({ _max: { sortOrder: true } });
      await fastify.prisma.leadSource.create({
        data: {
          label,
          sortOrder: (maxSort._max.sortOrder || 0) + 1,
        },
      });
      reply.flash('success', `Lead source "${label}" created.`);
    }

    return reply.redirect('/admin/lead-sources');
  });

  // POST /admin/lead-sources/:id — toggle active
  fastify.post('/lead-sources/:id', async (request, reply) => {
    const source = await fastify.prisma.leadSource.findUnique({
      where: { id: request.params.id },
    });

    if (!source) {
      reply.flash('error', 'Lead source not found.');
      return reply.redirect('/admin/lead-sources');
    }

    await fastify.prisma.leadSource.update({
      where: { id: request.params.id },
      data: { isActive: !source.isActive },
    });

    reply.flash('success', `Lead source "${source.label}" ${source.isActive ? 'deactivated' : 'activated'}.`);
    return reply.redirect('/admin/lead-sources');
  });
}

module.exports = leadSourceRoutes;
