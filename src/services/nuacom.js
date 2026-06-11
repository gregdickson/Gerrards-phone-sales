const config = require('../config');

const BASE_URL = 'https://api.nuacom.ie';

let sessionToken = null;
let tokenExpiresAt = 0;

async function getToken() {
  if (sessionToken && Date.now() < tokenExpiresAt) {
    return sessionToken;
  }

  const res = await fetch(`${BASE_URL}/login_digest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: config.NUACOM_EMAIL,
      pass: config.NUACOM_PASSWORD,
    }),
  });

  if (!res.ok) {
    throw new Error(`NUACOM login failed: ${res.status}`);
  }

  const data = await res.json();
  sessionToken = data.session_token;
  // Refresh 5 minutes before expiry
  tokenExpiresAt = Date.now() + (data.expire_in - 300) * 1000;
  return sessionToken;
}

async function nuacomFetch(method, path, body) {
  const token = await getToken();
  const options = {
    method,
    headers: {
      'X-Nuacom-Token': token,
      'Content-Type': 'application/json',
    },
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(`${BASE_URL}${path}`, options);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { success: res.ok, status: res.status, data };
}

/**
 * Search call logs for a phone number within a time range.
 * Returns calls sorted by date, most recent first.
 */
async function findCallsByNumber(phoneNumber, fromDate, toDate) {
  const params = new URLSearchParams({
    number: phoneNumber,
    from_date: fromDate,
    to_date: toDate,
    per_page: '10',
  });

  const result = await nuacomFetch('GET', `/v1/call_logs?${params}`);
  if (!result.success) return [];

  const calls = result.data._embedded || [];
  // Only return answered calls with recordings
  return calls.filter(c => c.recording && c.status !== 'NO ANSWER');
}

/**
 * Download a call recording as a Buffer.
 */
async function downloadRecording(callId) {
  const token = await getToken();
  const url = `${BASE_URL}/v1/recording?call_id=${encodeURIComponent(callId)}&format=mp3`;

  const res = await fetch(url, {
    headers: { 'X-Nuacom-Token': token },
  });

  if (!res.ok) {
    throw new Error(`Failed to download recording: ${res.status}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  return buffer;
}

module.exports = {
  findCallsByNumber,
  downloadRecording,
};
