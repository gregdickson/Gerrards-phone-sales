const config = require('../config');

const BASE_URL = 'https://services.leadconnectorhq.com';

async function ghlFetch(method, path, body) {
  const url = `${BASE_URL}${path}`;
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${config.GHL_API_KEY}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28',
    },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  return {
    success: res.ok,
    status: res.status,
    data,
    error: res.ok ? null : (Array.isArray(data.message) ? data.message.join('; ') : (data.message || data.msg || text)).slice(0, 500),
    responseBody: text.slice(0, 10000),
  };
}

async function upsertContact({
  firstName, lastName, phone, email, companyName,
  address1, city, state, country, postalCode,
  source, assignedTo, tags,
}) {
  const result = await ghlFetch('POST', '/contacts/upsert', {
    locationId: config.GHL_LOCATION_ID,
    firstName,
    lastName,
    phone,
    email,
    companyName,
    address1,
    city,
    state,
    country,
    postalCode,
    source,
    assignedTo,
    tags,
  });

  if (result.success && result.data?.contact?.id) {
    return { ...result, data: { id: result.data.contact.id } };
  }
  return result;
}

async function addTag(contactId, tag) {
  return ghlFetch('POST', `/contacts/${contactId}/tags`, {
    tags: [tag],
  });
}

async function createNote(contactId, body) {
  return ghlFetch('POST', `/contacts/${contactId}/notes`, {
    body,
  });
}

async function createOpportunity({ pipelineId, stageId, contactId, assignedTo, name }) {
  const result = await ghlFetch('POST', '/opportunities/', {
    pipelineId,
    pipelineStageId: stageId,
    contactId,
    assignedTo,
    name,
    status: 'open',
    locationId: config.GHL_LOCATION_ID,
  });

  if (result.success && result.data?.opportunity?.id) {
    return { ...result, data: { id: result.data.opportunity.id } };
  }
  return result;
}

async function listUsers() {
  return ghlFetch('GET', `/users/?locationId=${config.GHL_LOCATION_ID}`);
}

module.exports = {
  upsertContact,
  addTag,
  createNote,
  createOpportunity,
  listUsers,
};
