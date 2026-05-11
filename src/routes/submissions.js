const authenticate = require('../middleware/authenticate');
const config = require('../config');

async function submissionRoutes(fastify) {
  fastify.addHook('preHandler', authenticate);

  // GET /new — lead capture form
  fastify.get('/new', async (request, reply) => {
    const categorySlug = request.query.category;
    if (!categorySlug) {
      reply.flash('error', 'Please select a category first.');
      return reply.redirect('/');
    }

    const category = await fastify.prisma.insuranceCategory.findUnique({
      where: { slug: categorySlug },
    });
    if (!category || !category.isActive) {
      reply.flash('error', 'Invalid or inactive category.');
      return reply.redirect('/');
    }

    const leadSources = await fastify.prisma.leadSource.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    return reply.view('form.ejs', {
      pageTitle: `New Lead — ${category.label}`,
      user: request.user,
      category,
      leadSources,
      csrfToken: await reply.generateCsrf(),
      googlePlacesApiKey: config.GOOGLE_PLACES_API_KEY,
      values: {},
      errors: {},
    });
  });

  // POST /new — submit lead
  fastify.post('/new', async (request, reply) => {
    const body = request.body;
    const errors = {};

    // Validate required fields
    if (!body.lead_first_name?.trim()) errors.lead_first_name = 'First name is required';
    if (!body.lead_last_name?.trim()) errors.lead_last_name = 'Last name is required';
    if (!body.lead_phone?.trim()) errors.lead_phone = 'Phone is required';
    if (!body.lead_email?.trim()) errors.lead_email = 'Email is required';
    if (!body.organisation?.trim()) errors.organisation = 'Organisation is required';
    if (!body.street_address?.trim()) errors.street_address = 'Street address is required';
    if (!body.city?.trim()) errors.city = 'City is required';
    if (!body.state?.trim()) errors.state = 'State is required';
    if (!body.country?.trim()) errors.country = 'Country is required';
    if (!body.postal_code?.trim()) errors.postal_code = 'Postal code is required';
    if (!body.lead_source_id?.trim()) errors.lead_source_id = 'Lead source is required';
    if (!body.notes?.trim()) errors.notes = 'Notes are required';
    if (!body.category_id?.trim()) errors.category_id = 'Category is required';

    const category = await fastify.prisma.insuranceCategory.findUnique({
      where: { id: body.category_id || '' },
    });
    if (!category) errors.category_id = 'Invalid category';

    if (Object.keys(errors).length > 0) {
      const leadSources = await fastify.prisma.leadSource.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      });
      return reply.code(422).view('form.ejs', {
        pageTitle: `New Lead — ${category?.label || 'Unknown'}`,
        user: request.user,
        category: category || { label: 'Unknown', slug: '' },
        leadSources,
        csrfToken: await reply.generateCsrf(),
        googlePlacesApiKey: config.GOOGLE_PLACES_API_KEY,
        values: body,
        errors,
      });
    }

    // Create submission
    const submission = await fastify.prisma.submission.create({
      data: {
        salespersonUserId: request.user.id,
        insuranceCategoryId: body.category_id,
        leadSourceId: body.lead_source_id,
        leadFirstName: body.lead_first_name.trim(),
        leadLastName: body.lead_last_name.trim(),
        leadEmail: body.lead_email.trim(),
        leadPhone: body.lead_phone.trim(),
        organisation: body.organisation?.trim() || null,
        addressLine: body.street_address?.trim() || null,
        city: body.city?.trim() || null,
        state: body.state?.trim() || null,
        country: body.country?.trim() || 'NZ',
        postalCode: body.postal_code?.trim() || null,
        notes: body.notes.trim(),
      },
    });

    // Process submission inline
    const { processSubmission } = require('../services/submission-processor');
    try {
      await processSubmission(fastify.prisma, submission.id);
    } catch (err) {
      fastify.log.error({ err, submissionId: submission.id }, 'Submission processing error');
    }

    return reply.redirect(`/submissions/${submission.id}`);
  });

  // GET /submissions/:id — confirmation page
  fastify.get('/submissions/:id', async (request, reply) => {
    const submission = await fastify.prisma.submission.findUnique({
      where: { id: request.params.id },
      include: {
        category: true,
        leadSource: true,
        events: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!submission || submission.salespersonUserId !== request.user.id) {
      reply.flash('error', 'Submission not found.');
      return reply.redirect('/');
    }

    return reply.view('confirmation.ejs', {
      pageTitle: 'Submission',
      user: request.user,
      submission,
      csrfToken: await reply.generateCsrf(),
    });
  });

  // GET /my-submissions — recent submissions
  fastify.get('/my-submissions', async (request, reply) => {
    const submissions = await fastify.prisma.submission.findMany({
      where: { salespersonUserId: request.user.id },
      include: { category: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return reply.view('my-submissions.ejs', {
      pageTitle: 'My Submissions',
      user: request.user,
      submissions,
      csrfToken: await reply.generateCsrf(),
    });
  });
}

module.exports = submissionRoutes;
