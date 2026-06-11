const nuacomService = require('../services/nuacom');
const transcriptionService = require('../services/transcription');
const emailService = require('../services/email');

async function webhookRoutes(fastify) {
  // NUACOM call event webhook — no auth (NUACOM doesn't sign webhooks)
  fastify.post('/webhooks/nuacom/call-event', async (request, reply) => {
    const payload = request.body;

    fastify.log.info({
      callId: payload.call_id,
      direction: payload.call_direction,
      status: payload.call_status,
      terminated: payload.call_terminated,
      answered: payload.call_answered,
      recording: payload.recording_url ? 'yes' : 'no',
      callerNumber: payload.call_caller_number,
      calleeNumber: payload.call_callee_number,
    }, 'NUACOM call event received');

    // Only process completed/terminated calls with recordings
    const isCompleted = payload.call_terminated === true || payload.call_terminated === 'true'
      || payload.call_status === 'completed';
    const hasRecording = !!payload.recording_url;

    if (!isCompleted || !hasRecording) {
      return reply.send({ status: 'skipped', reason: !isCompleted ? 'not completed' : 'no recording' });
    }

    // Extract the external phone number (the lead's number, not the staff extension)
    const externalNumber = payload.call_direction === 'inbound'
      ? payload.call_caller_number
      : payload.call_callee_number;

    if (!externalNumber) {
      return reply.send({ status: 'skipped', reason: 'no external number' });
    }

    // Process in background so we respond to NUACOM quickly
    processCallTranscription(fastify.prisma, payload, externalNumber).catch(err => {
      fastify.log.error({ err, callId: payload.call_id }, 'Call transcription processing failed');
    });

    return reply.send({ status: 'accepted' });
  });
}

async function processCallTranscription(prisma, payload, externalNumber) {
  // Normalize the phone number — strip spaces, leading 0, add country code patterns
  const normalized = normalizePhone(externalNumber);

  // Find submissions in the last 2 hours that match this phone number
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const submissions = await prisma.submission.findMany({
    where: {
      createdAt: { gte: twoHoursAgo },
      status: { in: ['COMPLETE', 'PROCESSING'] },
    },
    include: {
      salesperson: true,
      category: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  // Match by phone number
  const matched = submissions.find(sub => {
    const subPhone = normalizePhone(sub.leadPhone);
    return subPhone === normalized || subPhone.endsWith(normalized) || normalized.endsWith(subPhone);
  });

  if (!matched) {
    console.log(`No submission match for phone ${externalNumber}`);
    return;
  }

  console.log(`Matched call ${payload.call_id} to submission ${matched.id} (${matched.leadFirstName} ${matched.leadLastName})`);

  // Download the recording from NUACOM
  let audioBuffer;
  try {
    audioBuffer = await nuacomService.downloadRecording(payload.call_id);
  } catch (err) {
    console.error(`Failed to download recording for ${payload.call_id}:`, err.message);
    return;
  }

  if (!audioBuffer || audioBuffer.length < 1000) {
    console.log(`Recording too small for ${payload.call_id}, skipping`);
    return;
  }

  // Transcribe with Whisper
  let transcriptionText;
  try {
    transcriptionText = await transcriptionService.transcribe(audioBuffer);
  } catch (err) {
    console.error(`Transcription failed for ${payload.call_id}:`, err.message);
    return;
  }

  if (!transcriptionText || transcriptionText.trim().length === 0) {
    console.log(`Empty transcription for ${payload.call_id}, skipping`);
    return;
  }

  // Email the transcription to the salesperson
  const callDate = payload.call_at
    ? new Date(payload.call_at).toLocaleString('en-NZ')
    : 'Unknown';

  await emailService.sendTranscription(
    matched.salesperson.email,
    matched.salesperson.name,
    {
      leadName: `${matched.leadFirstName} ${matched.leadLastName}`,
      leadPhone: matched.leadPhone,
      category: matched.category.label,
      callDate,
      callDirection: payload.call_direction || 'unknown',
      transcription: transcriptionText,
      submissionId: matched.id,
    }
  );

  console.log(`Transcription emailed to ${matched.salesperson.email} for submission ${matched.id}`);
}

function normalizePhone(phone) {
  if (!phone) return '';
  // Strip all non-digits
  let digits = phone.replace(/\D/g, '');
  // Remove leading 0 (NZ local format)
  if (digits.startsWith('0') && digits.length > 1) {
    digits = digits.slice(1);
  }
  // Remove NZ country code prefix
  if (digits.startsWith('64')) {
    digits = digits.slice(2);
  }
  // Remove international prefix
  if (digits.startsWith('0064')) {
    digits = digits.slice(4);
  }
  return digits;
}

module.exports = webhookRoutes;
