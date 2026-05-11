const authenticate = require('../middleware/authenticate');

async function landingRoutes(fastify) {
  fastify.addHook('preHandler', authenticate);

  // GET / — landing page with category buttons
  fastify.get('/', async (request, reply) => {
    const categories = await fastify.prisma.insuranceCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    return reply.view('landing.ejs', {
      pageTitle: 'Categories',
      user: request.user,
      categories,
      csrfToken: await reply.generateCsrf(),
    });
  });
}

module.exports = landingRoutes;
