const formData = require('form-data');
const Mailgun = require('mailgun.js');
const config = require('../config');

const mailgun = new Mailgun(formData);
const mg = mailgun.client({
  username: 'api',
  key: config.MAILGUN_API_KEY,
  url: config.MAILGUN_EU ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net',
});

async function sendMagicLink(email, magicLinkUrl) {
  try {
    await mg.messages.create(config.MAILGUN_DOMAIN, {
      from: config.EMAIL_FROM,
      to: [email],
      subject: 'Your Gerrards Login Link',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #1d4ed8;">Gerrards Phone & Referral</h2>
          <p>Click the link below to log in. This link expires in 15 minutes and can only be used once.</p>
          <a href="${magicLinkUrl}"
             style="display: inline-block; padding: 12px 24px; background: #1d4ed8; color: #fff; text-decoration: none; border-radius: 6px; margin: 16px 0;">
            Log In
          </a>
          <p style="color: #6b7280; font-size: 14px;">If you didn't request this link, you can safely ignore this email.</p>
        </div>
      `,
    });
    return { success: true };
  } catch (error) {
    console.error('Email send error:', error);
    return { success: false, error: error.message };
  }
}

module.exports = { sendMagicLink };
