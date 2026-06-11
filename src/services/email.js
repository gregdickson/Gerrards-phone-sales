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

async function sendTranscription(email, staffName, details) {
  try {
    const escapedTranscription = details.transcription
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');

    await mg.messages.create(config.MAILGUN_DOMAIN, {
      from: config.EMAIL_FROM,
      to: [email],
      subject: `Call Transcription — ${details.leadName} (${details.category})`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #ff7624; margin-bottom: 4px;">Gerrards Phone & Referral</h2>
          <p style="color: #6b7280; font-size: 14px; margin-top: 0;">Call Transcription</p>

          <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
            <tr>
              <td style="padding: 8px 0; color: #6b7280; width: 120px;">Lead</td>
              <td style="padding: 8px 0; font-weight: 600;">${details.leadName}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280;">Phone</td>
              <td style="padding: 8px 0;">${details.leadPhone}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280;">Category</td>
              <td style="padding: 8px 0;">${details.category}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280;">Call</td>
              <td style="padding: 8px 0;">${details.callDirection} — ${details.callDate}</td>
            </tr>
          </table>

          <div style="background: #f8f6f3; border-radius: 8px; padding: 20px; margin-top: 16px;">
            <h3 style="margin: 0 0 12px 0; font-size: 14px; color: #1a1a2e;">Transcription</h3>
            <p style="font-size: 14px; line-height: 1.6; color: #2d2d3f; white-space: pre-wrap; margin: 0;">
              ${escapedTranscription}
            </p>
          </div>

          <p style="color: #9ca3af; font-size: 12px; margin-top: 20px;">
            This transcription was generated automatically from the call recording.
          </p>
        </div>
      `,
    });
    return { success: true };
  } catch (error) {
    console.error('Transcription email error:', error);
    return { success: false, error: error.message };
  }
}

module.exports = { sendMagicLink, sendTranscription };
