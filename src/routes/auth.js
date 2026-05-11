const authService = require('../services/auth');
const emailService = require('../services/email');
const authenticate = require('../middleware/authenticate');
const config = require('../config');

async function authRoutes(fastify) {
  // GET /login — show login form
  fastify.get('/login', async (request, reply) => {
    return reply.view('login.ejs', {
      pageTitle: 'Login',
      csrfToken: await reply.generateCsrf(),
    });
  });

  // POST /login — send magic link
  fastify.post('/login', async (request, reply) => {
    const email = (request.body.email || '').trim().toLowerCase();

    // Always redirect to /login/sent (no email enumeration)
    if (!email) {
      return reply.redirect('/login/sent');
    }

    const user = await fastify.prisma.user.findUnique({
      where: { email },
    });

    if (user && user.isActive) {
      const { token } = await authService.generateMagicLink(fastify.prisma, user.id);
      const magicLinkUrl = `${config.APP_URL}/auth/${token}`;

      // In development, log the magic link URL
      if (process.env.NODE_ENV !== 'production') {
        fastify.log.info(`Magic link for ${email}: ${magicLinkUrl}`);
      }

      await emailService.sendMagicLink(email, magicLinkUrl);
    }

    return reply.redirect('/login/sent');
  });

  // GET /login/sent — "check your email" page
  fastify.get('/login/sent', async (request, reply) => {
    return reply.view('login-sent.ejs', {
      pageTitle: 'Check Your Email',
    });
  });

  // GET /auth/:token — verify magic link
  fastify.get('/auth/:token', async (request, reply) => {
    const { token } = request.params;
    const user = await authService.verifyMagicLink(fastify.prisma, token);

    if (!user) {
      reply.flash('error', 'This login link is invalid or has expired. Please request a new one.');
      return reply.redirect('/login');
    }

    const sessionId = await authService.createSession(
      fastify.prisma,
      user.id,
      request.headers['user-agent']
    );

    reply.setCookie('session_id', sessionId, {
      path: '/',
      signed: true,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });

    return reply.redirect('/');
  });

  // POST /logout — destroy session
  fastify.post('/logout', { preHandler: [authenticate] }, async (request, reply) => {
    const unsigned = request.unsignCookie(request.cookies.session_id);
    if (unsigned.valid && unsigned.value) {
      await authService.destroySession(fastify.prisma, unsigned.value);
    }
    reply.clearCookie('session_id', { path: '/' });
    return reply.redirect('/login');
  });
}

module.exports = authRoutes;
