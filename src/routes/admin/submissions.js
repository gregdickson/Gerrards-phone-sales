const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const { executeStep } = require('../../services/submission-processor');
const ghlService = require('../../services/ghl');
const webhookService = require('../../services/webhook');
const config = require('../../config');

async function adminSubmissionRoutes(fastify) {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', authorize);

  // GET /admin/submissions — filterable list
  fastify.get('/submissions', async (request, reply) => {
    const { staff, category, status, from, to } = request.query;
    const where = {};

    if (staff) where.salespersonUserId = staff;
    if (category) where.insuranceCategoryId = category;
    if (status) where.status = status;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to + 'T23:59:59Z');
    }

    const page = Math.max(1, parseInt(request.query.page || '1', 10));
    const perPage = 25;

    const [submissions, total] = await Promise.all([
      fastify.prisma.submission.findMany({
        where,
        include: { salesperson: true, category: true },
        orderBy: { createdAt: 'desc' },
        take: perPage,
        skip: (page - 1) * perPage,
      }),
      fastify.prisma.submission.count({ where }),
    ]);

    const staffList = await fastify.prisma.user.findMany({ orderBy: { name: 'asc' } });
    const categories = await fastify.prisma.insuranceCategory.findMany({ orderBy: { sortOrder: 'asc' } });

    return reply.view('admin/submissions-list.ejs', {
      pageTitle: 'All Submissions',
      user: request.user,
      submissions,
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
      staffList,
      categories,
      filters: { staff, category, status, from, to },
      csrfToken: await reply.generateCsrf(),
    });
  });

  // GET /admin/submissions/:id — detail
  fastify.get('/submissions/:id', async (request, reply) => {
    const submission = await fastify.prisma.submission.findUnique({
      where: { id: request.params.id },
      include: {
        salesperson: true,
        category: true,
        leadSource: true,
        events: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!submission) {
      reply.flash('error', 'Submission not found.');
      return reply.redirect('/admin/submissions');
    }

    return reply.view('admin/submission-detail.ejs', {
      pageTitle: `Submission ${submission.id.slice(0, 8)}`,
      user: request.user,
      submission,
      csrfToken: await reply.generateCsrf(),
    });
  });

  // POST /admin/submissions/:id/retry/:step — retry a failed step
  fastify.post('/submissions/:id/retry/:step', async (request, reply) => {
    const { id, step } = request.params;
    const validSteps = ['GHL_CONTACT', 'GHL_TAG', 'GHL_CONTACT_NOTE', 'STAFF_WEBHOOK', 'GHL_OPPORTUNITY'];

    if (!validSteps.includes(step)) {
      reply.flash('error', 'Invalid step.');
      return reply.redirect(`/admin/submissions/${id}`);
    }

    const submission = await fastify.prisma.submission.findUnique({
      where: { id },
      include: { salesperson: true, category: true, leadSource: true },
    });

    if (!submission) {
      reply.flash('error', 'Submission not found.');
      return reply.redirect('/admin/submissions');
    }

    // Execute the retry
    let result;
    switch (step) {
      case 'GHL_CONTACT':
        result = await executeStep(fastify.prisma, id, step, () =>
          ghlService.upsertContact({
            firstName: submission.leadFirstName,
            lastName: submission.leadLastName,
            phone: submission.leadPhone,
            email: submission.leadEmail,
            companyName: submission.organisation,
            address1: submission.addressLine,
            city: submission.city,
            state: submission.state,
            country: submission.country,
            postalCode: submission.postalCode,
            source: submission.leadSource.label,
            assignedTo: submission.salesperson.ghlUserId,
            tags: ['phone/referral'],
          })
        );
        if (result.success && result.data?.id) {
          await fastify.prisma.submission.update({
            where: { id },
            data: { ghlContactId: result.data.id },
          });
        }
        break;

      case 'GHL_TAG':
        if (!submission.ghlContactId) {
          reply.flash('error', 'Cannot retry tag — no GHL contact ID. Retry contact creation first.');
          return reply.redirect(`/admin/submissions/${id}`);
        }
        result = await executeStep(fastify.prisma, id, step, () =>
          ghlService.addTag(submission.ghlContactId, 'phone/referral')
        );
        break;

      case 'GHL_CONTACT_NOTE':
        if (!submission.ghlContactId) {
          reply.flash('error', 'Cannot retry note — no GHL contact ID.');
          return reply.redirect(`/admin/submissions/${id}`);
        }
        result = await executeStep(fastify.prisma, id, step, () =>
          ghlService.createNote(
            submission.ghlContactId,
            `Phone/Referral - ${submission.category.label} - ${submission.salesperson.name}\n\n${submission.notes}`
          )
        );
        break;

      case 'STAFF_WEBHOOK':
        if (!submission.salesperson.webhookUrl) {
          reply.flash('error', 'No webhook URL configured for this staff member.');
          return reply.redirect(`/admin/submissions/${id}`);
        }
        result = await executeStep(fastify.prisma, id, step, () =>
          webhookService.send(submission.salesperson.webhookUrl, {
            first_name: submission.leadFirstName,
            last_name: submission.leadLastName,
            phone: submission.leadPhone,
            email: submission.leadEmail,
            business_name: submission.organisation || '',
            contact_notes: submission.notes,
            street_address: submission.addressLine || '',
            city: submission.city || '',
            state: submission.state || '',
            country: submission.country || '',
            post_code: submission.postalCode || '',
          })
        );
        if (result.status) {
          await fastify.prisma.submission.update({
            where: { id },
            data: { webhookResponseStatus: result.status },
          });
        }
        break;

      case 'GHL_OPPORTUNITY':
        if (!submission.ghlContactId) {
          reply.flash('error', 'Cannot retry opportunity — no GHL contact ID.');
          return reply.redirect(`/admin/submissions/${id}`);
        }
        result = await executeStep(fastify.prisma, id, step, () =>
          ghlService.createOpportunity({
            pipelineId: config.GHL_PIPELINE_ID,
            stageId: config.GHL_STAGE_ID,
            contactId: submission.ghlContactId,
            assignedTo: submission.salesperson.ghlUserId,
            name: `${submission.leadFirstName} ${submission.leadLastName} - ${submission.category.label}`,
          })
        );
        if (result.success && result.data?.id) {
          await fastify.prisma.submission.update({
            where: { id },
            data: { ghlOpportunityId: result.data.id },
          });
        }
        break;
    }

    // Check if all steps now have at least one success
    const events = await fastify.prisma.submissionEvent.findMany({
      where: { submissionId: id },
    });

    const stepSuccesses = {};
    for (const event of events) {
      if (event.succeeded) stepSuccesses[event.step] = true;
    }

    const allFatalStepsOk = ['GHL_CONTACT', 'GHL_TAG', 'GHL_OPPORTUNITY'].every(s => stepSuccesses[s]);
    if (allFatalStepsOk && submission.status === 'FAILED') {
      await fastify.prisma.submission.update({
        where: { id },
        data: { status: 'COMPLETE', completedAt: new Date() },
      });
      reply.flash('success', 'Retry succeeded — submission marked as COMPLETE.');
    } else if (result.success) {
      reply.flash('success', `Step ${step} retried successfully.`);
    } else {
      reply.flash('error', `Retry failed: ${result.error || 'Unknown error'}`);
    }

    return reply.redirect(`/admin/submissions/${id}`);
  });
}

module.exports = adminSubmissionRoutes;
