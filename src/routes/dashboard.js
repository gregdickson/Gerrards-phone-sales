const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { getDashboardData } = require('../services/dashboard-data');

async function dashboardRoutes(fastify) {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', authorize); // admin-only — cross-broker financials

  // GET /dashboard — the dashboard shell (charts hydrate from /dashboard/data)
  fastify.get('/dashboard', async (request, reply) => {
    return reply.view('dashboard.ejs', {
      pageTitle: 'Performance Dashboard',
      user: request.user,
      csrfToken: await reply.generateCsrf(),
      bareLayout: true,
    });
  });

  // GET /dashboard/data — aggregated JSON for the charts
  fastify.get('/dashboard/data', async (request, reply) => {
    try {
      const data = await getDashboardData(fastify.prisma);
      return reply.send(data);
    } catch (err) {
      fastify.log.error({ err }, 'Dashboard data query failed');
      return reply.code(500).send({ error: 'Failed to load dashboard data' });
    }
  });
}

module.exports = dashboardRoutes;
