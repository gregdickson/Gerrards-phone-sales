const config = require('../config');

const FOLIO_URL = 'https://api-66ju4ddwuq-ts.a.run.app/new-business/create';
const FOLIO_API_KEY = 'api-key-2654af70-c03c-411d-8240-c3f11379ff10';

async function createNewBusiness(submission) {
  const body = {
    firstName: submission.leadFirstName,
    lastName: submission.leadLastName,
    phoneNumber: submission.leadPhone,
    email: submission.leadEmail,
    insuredName: submission.organisation || '',
    physicalAddress: submission.addressLine || '',
    city: submission.city || '',
    country: submission.country || '',
    postCode: submission.postalCode || '',
    suburb: submission.state || '',
    notes: (submission.notes || '').replace(/\n/g, ' ').replace(/\r/g, ' '),
    clientType: 'commercial',
    riskInfo: ['contractorsPlantAndMachinery'],
    assignee: submission.salesperson.email,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(FOLIO_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': FOLIO_API_KEY,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();

    return {
      success: res.ok,
      status: res.status,
      data: res.ok ? (text ? JSON.parse(text) : {}) : null,
      error: res.ok ? null : text.slice(0, 500),
      responseBody: text.slice(0, 10000),
    };
  } catch (error) {
    return {
      success: false,
      status: null,
      error: error.name === 'AbortError' ? 'Request timed out (15s)' : error.message,
      responseBody: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { createNewBusiness };
