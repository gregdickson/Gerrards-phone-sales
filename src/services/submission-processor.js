const ghlService = require('./ghl');
const webhookService = require('./webhook');
const config = require('../config');

async function executeStep(prisma, submissionId, step, fn) {
  try {
    const result = await fn();

    await prisma.submissionEvent.create({
      data: {
        submissionId,
        step,
        succeeded: result.success,
        responseStatus: result.status || null,
        responseBody: (result.responseBody || '').slice(0, 10000) || null,
        errorMessage: result.error || null,
      },
    });

    return result;
  } catch (error) {
    await prisma.submissionEvent.create({
      data: {
        submissionId,
        step,
        succeeded: false,
        errorMessage: error.message?.slice(0, 10000) || 'Unknown error',
      },
    });

    return { success: false, error: error.message };
  }
}

async function markFailed(prisma, submissionId) {
  await prisma.submission.update({
    where: { id: submissionId },
    data: { status: 'FAILED', completedAt: new Date() },
  });
}

function formatNote(submission) {
  return `Phone/Referral - ${submission.category.label} - ${submission.salesperson.name}\n\n${submission.notes}`;
}

async function processSubmission(prisma, submissionId) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: {
      salesperson: true,
      category: true,
      leadSource: true,
    },
  });

  if (!submission) throw new Error(`Submission ${submissionId} not found`);

  // Step 1: GHL Upsert Contact (FATAL)
  const contactResult = await executeStep(prisma, submissionId, 'GHL_CONTACT', () =>
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

  if (!contactResult.success) {
    return markFailed(prisma, submissionId);
  }

  const contactId = contactResult.data.id;
  await prisma.submission.update({
    where: { id: submissionId },
    data: { ghlContactId: contactId },
  });

  // Step 2: GHL Add Tag (FATAL)
  const tagResult = await executeStep(prisma, submissionId, 'GHL_TAG', () =>
    ghlService.addTag(contactId, 'phone/referral')
  );

  if (!tagResult.success) {
    return markFailed(prisma, submissionId);
  }

  // Step 3: GHL Create Note (NON-FATAL)
  await executeStep(prisma, submissionId, 'GHL_CONTACT_NOTE', () =>
    ghlService.createNote(contactId, formatNote(submission))
  );

  // Step 4: Staff Webhook (NON-FATAL)
  if (submission.salesperson.webhookUrl) {
    const webhookResult = await executeStep(prisma, submissionId, 'STAFF_WEBHOOK', () =>
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

    if (webhookResult.status) {
      await prisma.submission.update({
        where: { id: submissionId },
        data: { webhookResponseStatus: webhookResult.status },
      });
    }
  }

  // Step 5: GHL Create Opportunity (FATAL)
  const oppResult = await executeStep(prisma, submissionId, 'GHL_OPPORTUNITY', () =>
    ghlService.createOpportunity({
      pipelineId: config.GHL_PIPELINE_ID,
      stageId: config.GHL_STAGE_ID,
      contactId,
      assignedTo: submission.salesperson.ghlUserId,
      name: `${submission.leadFirstName} ${submission.leadLastName} - ${submission.category.label}`,
    })
  );

  if (!oppResult.success) {
    return markFailed(prisma, submissionId);
  }

  // All done
  await prisma.submission.update({
    where: { id: submissionId },
    data: {
      ghlOpportunityId: oppResult.data.id,
      status: 'COMPLETE',
      completedAt: new Date(),
    },
  });
}

module.exports = { processSubmission, executeStep };
