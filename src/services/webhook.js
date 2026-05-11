async function send(url, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    return {
      success: res.ok,
      status: res.status,
      responseBody: (await res.text().catch(() => '')).slice(0, 10000),
    };
  } catch (error) {
    return {
      success: false,
      status: null,
      error: error.name === 'AbortError' ? 'Request timed out (10s)' : error.message,
      responseBody: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { send };
