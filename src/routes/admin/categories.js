const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');

async function categoryRoutes(fastify) {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', authorize);

  // GET /admin/categories
  fastify.get('/categories', async (request, reply) => {
    const categories = await fastify.prisma.insuranceCategory.findMany({
      orderBy: { sortOrder: 'asc' },
    });

    return reply.view('admin/categories.ejs', {
      pageTitle: 'Insurance Categories',
      user: request.user,
      categories,
      csrfToken: await reply.generateCsrf(),
      editId: request.query.edit || null,
      errors: {},
    });
  });

  // POST /admin/categories — create or update
  fastify.post('/categories', async (request, reply) => {
    const body = request.body;
    const errors = {};

    if (!body.label?.trim()) errors.label = 'Label is required';

    if (Object.keys(errors).length > 0) {
      const categories = await fastify.prisma.insuranceCategory.findMany({
        orderBy: { sortOrder: 'asc' },
      });
      return reply.code(422).view('admin/categories.ejs', {
        pageTitle: 'Insurance Categories',
        user: request.user,
        categories,
        csrfToken: await reply.generateCsrf(),
        editId: body.id || null,
        errors,
      });
    }

    const label = body.label.trim();
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const utmCampaign = body.utm_campaign?.trim() || slug;

    if (body.id) {
      // Update
      await fastify.prisma.insuranceCategory.update({
        where: { id: body.id },
        data: {
          label,
          utmCampaign,
          sortOrder: parseInt(body.sort_order || '0', 10),
        },
      });
      reply.flash('success', `Category "${label}" updated.`);
    } else {
      // Create
      const maxSort = await fastify.prisma.insuranceCategory.aggregate({ _max: { sortOrder: true } });
      await fastify.prisma.insuranceCategory.create({
        data: {
          slug,
          label,
          utmCampaign,
          sortOrder: (maxSort._max.sortOrder || 0) + 1,
        },
      });
      reply.flash('success', `Category "${label}" created.`);
    }

    return reply.redirect('/admin/categories');
  });

  // POST /admin/categories/:id — toggle active
  fastify.post('/categories/:id', async (request, reply) => {
    const action = request.body.action;
    const category = await fastify.prisma.insuranceCategory.findUnique({
      where: { id: request.params.id },
    });

    if (!category) {
      reply.flash('error', 'Category not found.');
      return reply.redirect('/admin/categories');
    }

    if (action === 'toggle') {
      await fastify.prisma.insuranceCategory.update({
        where: { id: request.params.id },
        data: { isActive: !category.isActive },
      });
      reply.flash('success', `Category "${category.label}" ${category.isActive ? 'deactivated' : 'activated'}.`);
    }

    return reply.redirect('/admin/categories');
  });
}

module.exports = categoryRoutes;
