const crypto = require('crypto');
const authenticate = require('../middleware/authenticate');
const ghlService = require('../services/ghl');

const OUTCOMES = ['WON', 'LOST'];
const BUSINESS_TYPES = ['NEW_BUSINESS', 'RENEWAL'];
const LOST_REASONS = ['WENT_DIRECT', 'PRICE', 'INCUMBENT_BROKER', 'NO_APPETITE', 'CUSTOMER_WITHDREW', 'OTHER'];

// Parse a money/number field → finite Number or null. Strips $ and commas so a
// broker can paste "$12,500" without breaking the calc.
function num(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// est brokerage = premium × base% + broker fee + funding commission
function computeBrokerage({ annualPremium, baseCommissionPct, brokerFee, fundingCommission }) {
  const base = (annualPremium != null && baseCommissionPct != null)
    ? annualPremium * (baseCommissionPct / 100)
    : 0;
  const total = base + (brokerFee || 0) + (fundingCommission || 0);
  return Math.round(total * 100) / 100;
}

async function loadFormRefs(prisma) {
  const [categories, insurers] = await Promise.all([
    prisma.insuranceCategory.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.insurer.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
  ]);
  return { categories, insurers };
}

async function conversionRoutes(fastify) {
  fastify.addHook('preHandler', authenticate);

  // GET /conversions/new — log a conversion. ?from=<submissionId> pre-fills from
  // a lead this broker captured in the app.
  fastify.get('/conversions/new', async (request, reply) => {
    const { categories, insurers } = await loadFormRefs(fastify.prisma);

    const values = {};
    let fromSubmission = null;
    if (request.query.from) {
      const sub = await fastify.prisma.submission.findUnique({ where: { id: request.query.from } });
      if (sub && sub.salespersonUserId === request.user.id) {
        fromSubmission = sub;
        values.client_name = sub.organisation || `${sub.leadFirstName} ${sub.leadLastName}`;
        values.insurance_category_id = sub.insuranceCategoryId;
        values.submission_id = sub.id;
        values.ghl_contact_id = sub.ghlContactId || '';
        values.ghl_opportunity_id = sub.ghlOpportunityId || '';
      }
    }

    return reply.view('conversion-form.ejs', {
      pageTitle: 'Log Conversion',
      user: request.user,
      categories,
      insurers,
      fromSubmission,
      outcomes: OUTCOMES,
      businessTypes: BUSINESS_TYPES,
      lostReasons: LOST_REASONS,
      csrfToken: await reply.generateCsrf(),
      submitToken: crypto.randomUUID(),
      values,
      errors: {},
    });
  });

  // POST /conversions/new
  fastify.post('/conversions/new', async (request, reply) => {
    const body = request.body;
    const errors = {};

    const outcome = OUTCOMES.includes(body.outcome) ? body.outcome : null;
    if (!outcome) errors.outcome = 'Select Won or Lost';
    if (!body.client_name?.trim()) errors.client_name = 'Client / business name is required';

    if (outcome === 'WON') {
      if (!BUSINESS_TYPES.includes(body.business_type)) errors.business_type = 'New business or renewal?';
      if (!body.insurer_id?.trim()) errors.insurer_id = 'Insurer is required';
      if (!body.insurance_category_id?.trim()) errors.insurance_category_id = 'Class of business is required';
      if (num(body.annual_premium) == null || num(body.annual_premium) <= 0) errors.annual_premium = 'Annual premium is required';
    }
    if (outcome === 'LOST') {
      if (!LOST_REASONS.includes(body.lost_reason)) errors.lost_reason = 'Select a reason';
    }

    if (Object.keys(errors).length > 0) {
      const { categories, insurers } = await loadFormRefs(fastify.prisma);
      return reply.code(422).view('conversion-form.ejs', {
        pageTitle: 'Log Conversion',
        user: request.user,
        categories,
        insurers,
        fromSubmission: null,
        outcomes: OUTCOMES,
        businessTypes: BUSINESS_TYPES,
        lostReasons: LOST_REASONS,
        csrfToken: await reply.generateCsrf(),
        submitToken: body.submit_token?.trim() || crypto.randomUUID(),
        values: body,
        errors,
      });
    }

    // Resolve commission %: explicit override else the insurer default.
    let baseCommissionPct = num(body.base_commission_pct);
    let insurerId = body.insurer_id?.trim() || null;
    if (outcome === 'WON' && insurerId && baseCommissionPct == null) {
      const insurer = await fastify.prisma.insurer.findUnique({ where: { id: insurerId } });
      if (insurer) baseCommissionPct = Number(insurer.defaultCommissionPct);
    }

    const premiumFunded = body.premium_funded === 'on' || body.premium_funded === 'true';
    const annualPremium = outcome === 'WON' ? num(body.annual_premium) : null;
    const brokerFee = outcome === 'WON' ? num(body.broker_fee) : null;
    const fundingCommission = outcome === 'WON' && premiumFunded ? num(body.funding_commission) : null;
    const estBrokerage = outcome === 'WON'
      ? computeBrokerage({ annualPremium, baseCommissionPct, brokerFee, fundingCommission })
      : null;

    const submitToken = body.submit_token?.trim() || crypto.randomUUID();
    let conversion;
    try {
      conversion = await fastify.prisma.conversion.create({
        data: {
          brokerUserId: request.user.id,
          submissionId: body.submission_id?.trim() || null,
          ghlContactId: body.ghl_contact_id?.trim() || null,
          ghlOpportunityId: body.ghl_opportunity_id?.trim() || null,
          clientName: body.client_name.trim(),
          outcome,
          businessType: outcome === 'WON' ? body.business_type : null,
          insuranceCategoryId: outcome === 'WON' ? (body.insurance_category_id?.trim() || null) : null,
          insurerId: outcome === 'WON' ? insurerId : null,
          policiesBound: outcome === 'WON' ? Math.max(1, parseInt(body.policies_bound || '1', 10) || 1) : 1,
          annualPremium,
          inceptionDate: outcome === 'WON' && body.inception_date ? new Date(body.inception_date) : null,
          brokerFee,
          premiumFunded: outcome === 'WON' ? premiumFunded : false,
          funder: outcome === 'WON' && premiumFunded ? (body.funder?.trim() || null) : null,
          fundingCommission,
          baseCommissionPct: outcome === 'WON' ? baseCommissionPct : null,
          estBrokerage,
          lostReason: outcome === 'LOST' ? body.lost_reason : null,
          competitor: outcome === 'LOST' ? (body.competitor?.trim() || null) : null,
          notes: body.notes?.trim() || null,
          submitToken,
        },
      });
    } catch (err) {
      if (err.code === 'P2002') {
        // Duplicate submit (double-click / resubmit) — send to the original.
        const existing = await fastify.prisma.conversion.findUnique({ where: { submitToken } });
        if (existing) {
          fastify.log.warn({ submitToken, conversionId: existing.id }, 'Duplicate conversion submit blocked');
          return reply.redirect(`/conversions/${existing.id}`);
        }
      }
      throw err;
    }

    // Write the outcome back to GHL if we have the opportunity (NON-FATAL).
    if (conversion.ghlOpportunityId) {
      try {
        const result = await ghlService.updateOpportunity(conversion.ghlOpportunityId, {
          status: outcome === 'WON' ? 'won' : 'lost',
          monetaryValue: outcome === 'WON' ? estBrokerage : undefined,
        });
        if (outcome === 'LOST' && conversion.ghlContactId) {
          await ghlService.createNote(conversion.ghlContactId,
            `Lost — ${body.lost_reason}${body.competitor ? ` (${body.competitor.trim()})` : ''} — ${request.user.name}`);
        }
        await fastify.prisma.conversion.update({
          where: { id: conversion.id },
          data: { ghlWritebackStatus: result.status || null },
        });
      } catch (err) {
        fastify.log.error({ err, conversionId: conversion.id }, 'GHL write-back failed');
      }
    }

    return reply.redirect(`/conversions/${conversion.id}`);
  });

  // GET /conversions/:id — confirmation
  fastify.get('/conversions/:id', async (request, reply) => {
    const conversion = await fastify.prisma.conversion.findUnique({
      where: { id: request.params.id },
      include: { category: true, insurer: true, broker: true },
    });
    if (!conversion || conversion.brokerUserId !== request.user.id) {
      reply.flash('error', 'Conversion not found.');
      return reply.redirect('/my-conversions');
    }
    return reply.view('conversion-confirmation.ejs', {
      pageTitle: 'Conversion Logged',
      user: request.user,
      conversion,
      csrfToken: await reply.generateCsrf(),
    });
  });

  // GET /my-conversions — recent conversions for this broker
  fastify.get('/my-conversions', async (request, reply) => {
    const conversions = await fastify.prisma.conversion.findMany({
      where: { brokerUserId: request.user.id },
      include: { category: true, insurer: true },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
    return reply.view('my-conversions.ejs', {
      pageTitle: 'My Conversions',
      user: request.user,
      conversions,
      csrfToken: await reply.generateCsrf(),
    });
  });
}

module.exports = conversionRoutes;
