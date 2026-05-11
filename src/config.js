const path = require('path');

// Load .env in development
if (process.env.NODE_ENV !== 'production') {
  try {
    const fs = require('fs');
    const envPath = path.resolve(__dirname, '..', '.env');
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env file not found — that's fine, use existing env vars
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const config = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  APP_URL: requireEnv('APP_URL'),
  COOKIE_SECRET: requireEnv('COOKIE_SECRET'),
  DATABASE_URL: requireEnv('DATABASE_URL'),

  GHL_API_KEY: requireEnv('GHL_API_KEY'),
  GHL_LOCATION_ID: requireEnv('GHL_LOCATION_ID'),
  GHL_PIPELINE_ID: requireEnv('GHL_PIPELINE_ID'),
  GHL_STAGE_ID: requireEnv('GHL_STAGE_ID'),

  MAILGUN_API_KEY: requireEnv('MAILGUN_API_KEY'),
  MAILGUN_DOMAIN: requireEnv('MAILGUN_DOMAIN'),
  MAILGUN_EU: process.env.MAILGUN_EU === 'true',
  EMAIL_FROM: requireEnv('EMAIL_FROM'),

  GOOGLE_PLACES_API_KEY: requireEnv('GOOGLE_PLACES_API_KEY'),
};

module.exports = config;
