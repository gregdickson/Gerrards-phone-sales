const authService = require('../services/auth');

async function authenticate(request, reply) {
  const sessionId = request.cookies.session_id;
  if (!sessionId) {
    return reply.redirect('/login');
  }

  // Unsign the cookie
  const unsigned = request.unsignCookie(sessionId);
  if (!unsigned.valid || !unsigned.value) {
    reply.clearCookie('session_id', { path: '/' });
    return reply.redirect('/login');
  }

  const user = await authService.getSessionUser(request.server.prisma, unsigned.value);
  if (!user) {
    reply.clearCookie('session_id', { path: '/' });
    return reply.redirect('/login');
  }

  request.user = user;
}

module.exports = authenticate;
