async function authorize(request, reply) {
  if (!request.user || request.user.role !== 'ADMIN') {
    return reply.code(403).view('layouts/main.ejs', {
      body: '<div class="text-center py-16"><h1 class="text-2xl font-bold text-red-600">Access Denied</h1><p class="mt-2 text-gray-600">You do not have permission to access this page.</p></div>',
      user: request.user,
      flash: null,
      csrfToken: '',
      pageTitle: 'Access Denied',
    });
  }
}

module.exports = authorize;
