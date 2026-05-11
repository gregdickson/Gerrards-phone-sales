const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const ghlService = require('../../services/ghl');

async function staffRoutes(fastify) {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', authorize);

  // GET /admin/staff — list
  fastify.get('/staff', async (request, reply) => {
    const staff = await fastify.prisma.user.findMany({
      orderBy: { name: 'asc' },
    });

    return reply.view('admin/staff-list.ejs', {
      pageTitle: 'Staff Management',
      user: request.user,
      staff,
      csrfToken: await reply.generateCsrf(),
    });
  });

  // GET /admin/staff/new — add form
  fastify.get('/staff/new', async (request, reply) => {
    let ghlUsers = [];
    try {
      const result = await ghlService.listUsers();
      if (result.success && result.data?.users) {
        ghlUsers = result.data.users;
      }
    } catch { /* GHL unavailable — manual entry */ }

    return reply.view('admin/staff-edit.ejs', {
      pageTitle: 'Add Staff',
      user: request.user,
      staffMember: null,
      ghlUsers,
      csrfToken: await reply.generateCsrf(),
      errors: {},
    });
  });

  // POST /admin/staff — create
  fastify.post('/staff', async (request, reply) => {
    const body = request.body;
    const errors = {};

    if (!body.name?.trim()) errors.name = 'Name is required';
    if (!body.email?.trim()) errors.email = 'Email is required';
    if (!body.ghl_user_id?.trim()) errors.ghl_user_id = 'GHL User ID is required';

    const email = (body.email || '').trim().toLowerCase();
    if (email) {
      const existing = await fastify.prisma.user.findUnique({ where: { email } });
      if (existing) errors.email = 'A user with this email already exists';
    }

    if (Object.keys(errors).length > 0) {
      return reply.code(422).view('admin/staff-edit.ejs', {
        pageTitle: 'Add Staff',
        user: request.user,
        staffMember: body,
        ghlUsers: [],
        csrfToken: await reply.generateCsrf(),
        errors,
      });
    }

    await fastify.prisma.user.create({
      data: {
        name: body.name.trim(),
        email,
        ghlUserId: body.ghl_user_id.trim(),
        webhookUrl: body.webhook_url?.trim() || null,
        role: body.role === 'ADMIN' ? 'ADMIN' : 'STAFF',
      },
    });

    reply.flash('success', `Staff member ${body.name.trim()} created.`);
    return reply.redirect('/admin/staff');
  });

  // GET /admin/staff/:id — edit form
  fastify.get('/staff/:id', async (request, reply) => {
    const staffMember = await fastify.prisma.user.findUnique({
      where: { id: request.params.id },
    });

    if (!staffMember) {
      reply.flash('error', 'Staff member not found.');
      return reply.redirect('/admin/staff');
    }

    let ghlUsers = [];
    try {
      const result = await ghlService.listUsers();
      if (result.success && result.data?.users) {
        ghlUsers = result.data.users;
      }
    } catch { /* GHL unavailable */ }

    return reply.view('admin/staff-edit.ejs', {
      pageTitle: `Edit ${staffMember.name}`,
      user: request.user,
      staffMember,
      ghlUsers,
      csrfToken: await reply.generateCsrf(),
      errors: {},
    });
  });

  // POST /admin/staff/:id — update
  fastify.post('/staff/:id', async (request, reply) => {
    const body = request.body;
    const staffMember = await fastify.prisma.user.findUnique({
      where: { id: request.params.id },
    });

    if (!staffMember) {
      reply.flash('error', 'Staff member not found.');
      return reply.redirect('/admin/staff');
    }

    const errors = {};
    if (!body.name?.trim()) errors.name = 'Name is required';
    if (!body.email?.trim()) errors.email = 'Email is required';
    if (!body.ghl_user_id?.trim()) errors.ghl_user_id = 'GHL User ID is required';

    const email = (body.email || '').trim().toLowerCase();
    if (email && email !== staffMember.email) {
      const existing = await fastify.prisma.user.findUnique({ where: { email } });
      if (existing) errors.email = 'A user with this email already exists';
    }

    if (Object.keys(errors).length > 0) {
      return reply.code(422).view('admin/staff-edit.ejs', {
        pageTitle: `Edit ${staffMember.name}`,
        user: request.user,
        staffMember: { ...staffMember, ...body },
        ghlUsers: [],
        csrfToken: await reply.generateCsrf(),
        errors,
      });
    }

    await fastify.prisma.user.update({
      where: { id: request.params.id },
      data: {
        name: body.name.trim(),
        email,
        ghlUserId: body.ghl_user_id.trim(),
        webhookUrl: body.webhook_url?.trim() || null,
        role: body.role === 'ADMIN' ? 'ADMIN' : 'STAFF',
      },
    });

    reply.flash('success', `Staff member ${body.name.trim()} updated.`);
    return reply.redirect('/admin/staff');
  });

  // POST /admin/staff/:id/deactivate — toggle active
  fastify.post('/staff/:id/deactivate', async (request, reply) => {
    const staffMember = await fastify.prisma.user.findUnique({
      where: { id: request.params.id },
    });

    if (!staffMember) {
      reply.flash('error', 'Staff member not found.');
      return reply.redirect('/admin/staff');
    }

    const newActive = !staffMember.isActive;

    await fastify.prisma.user.update({
      where: { id: request.params.id },
      data: { isActive: newActive },
    });

    // If deactivating, destroy all sessions
    if (!newActive) {
      await fastify.prisma.session.deleteMany({
        where: { userId: request.params.id },
      });
    }

    reply.flash('success', `${staffMember.name} ${newActive ? 'activated' : 'deactivated'}.`);
    return reply.redirect('/admin/staff');
  });
}

module.exports = staffRoutes;
