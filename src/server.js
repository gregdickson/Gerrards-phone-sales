const path = require('path');
const config = require('./config');
const fastify = require('fastify')({ logger: true });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function build() {
  // Decorate with prisma
  fastify.decorate('prisma', prisma);

  // Parse form bodies
  await fastify.register(require('@fastify/formbody'));

  // Signed cookies
  await fastify.register(require('@fastify/cookie'), {
    secret: config.COOKIE_SECRET,
    parseOptions: {},
  });

  // CSRF protection
  await fastify.register(require('@fastify/csrf-protection'), {
    sessionPlugin: '@fastify/cookie',
    cookieOpts: { signed: true, httpOnly: true, sameSite: 'lax', path: '/' },
  });

  // Static files
  await fastify.register(require('@fastify/static'), {
    root: path.join(__dirname, '..', 'public'),
    prefix: '/',
  });

  // EJS templates
  await fastify.register(require('@fastify/view'), {
    engine: { ejs: require('ejs') },
    root: path.join(__dirname, 'views'),
    layout: 'layouts/main.ejs',
    defaultContext: {
      user: null,
      flash: null,
      csrfToken: '',
      pageTitle: '',
    },
  });

  // Flash message helper via cookie
  fastify.decorateRequest('flash', null);
  fastify.addHook('preHandler', async (request, reply) => {
    const flashCookie = request.cookies._flash;
    if (flashCookie) {
      try {
        request.flash = JSON.parse(flashCookie);
      } catch {
        request.flash = null;
      }
      reply.clearCookie('_flash', { path: '/' });
    }
  });
  fastify.decorateReply('flash', function (type, message) {
    this.setCookie('_flash', JSON.stringify({ type, message }), {
      path: '/',
      httpOnly: true,
      maxAge: 60,
    });
  });

  // Health check (no auth)
  fastify.get('/health', async () => ({ status: 'ok' }));

  // Register routes
  await fastify.register(require('./routes/webhooks'));
  await fastify.register(require('./routes/auth'));
  await fastify.register(require('./routes/landing'));
  await fastify.register(require('./routes/submissions'));
  await fastify.register(require('./routes/conversions'));
  await fastify.register(require('./routes/admin/staff'), { prefix: '/admin' });
  await fastify.register(require('./routes/admin/categories'), { prefix: '/admin' });
  await fastify.register(require('./routes/admin/lead-sources'), { prefix: '/admin' });
  await fastify.register(require('./routes/admin/insurers'), { prefix: '/admin' });
  await fastify.register(require('./routes/admin/submissions'), { prefix: '/admin' });

  return fastify;
}

async function start() {
  try {
    const app = await build();
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

start();
