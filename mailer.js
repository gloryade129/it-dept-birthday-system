const nodemailer = require('nodemailer');
const { getSetting } = require('./database');

async function createTransporter(overrideUser = null) {
  const host = process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com';
  const port = parseInt(process.env.BREVO_SMTP_PORT || '587', 10);
  const senderEmail = process.env.BREVO_SENDER_EMAIL || await getSetting('brevoSenderEmail');
  
  // Brevo SMTP login username is your Brevo account email address (or BREVO_SMTP_USER)
  let user = overrideUser || process.env.BREVO_SMTP_USER || await getSetting('brevoSmtpUser');
  if (!user || user.endsWith('@smtp-brevo.com')) {
    user = senderEmail || user;
  }

  const pass = process.env.BREVO_SMTP_PASSWORD || await getSetting('brevoApiKey') || await getSetting('brevoSmtpPassword');

  if (!user || !pass) {
    console.warn('⚠️ Brevo SMTP Credentials missing. Email dispatches will be logged but not sent until configured in Admin UI / .env');
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass
    }
  });
}

/**
 * Replace placeholders in string/HTML templates
 */
function renderTemplate(templateStr, data) {
  if (!templateStr) return '';
  let result = templateStr;
  for (const [key, val] of Object.entries(data)) {
    const reg = new RegExp(`\\{${key}\\}`, 'g');
    result = result.replace(reg, val || '');
  }
  return result;
}

/**
 * Fallback: Send Email via Brevo HTTP v3 REST API (bypasses SMTP 535 auth blocks)
 */
async function sendViaBrevoApi({ to, subject, html, text, senderEmail, senderName, apiKey }) {
  const url = 'https://api.brevo.com/v3/smtp/email';
  const payload = {
    sender: {
      name: senderName || 'IT Dept 25/26',
      email: senderEmail || 'adeniranglory129@gmail.com'
    },
    to: [{ email: to }],
    subject: subject,
    htmlContent: html,
    textContent: text || html.replace(/<[^>]+>/g, '')
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': apiKey,
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (response.ok) {
    console.log(`✉️ Email sent to ${to} via Brevo HTTP REST API! Message ID: ${data.messageId || data.id}`);
    return data;
  } else {
    throw new Error(`Brevo HTTP API Error (${response.status}): ${data.message || JSON.stringify(data)}`);
  }
}

/**
 * Send Email via Brevo (Tries SMTP first, falls back to HTTP REST API automatically)
 */
async function sendEmail({ to, subject, html, text }) {
  const senderEmail = process.env.BREVO_SENDER_EMAIL || await getSetting('brevoSenderEmail') || 'adeniranglory129@gmail.com';
  const senderName = process.env.BREVO_SENDER_NAME || await getSetting('brevoSenderName') || 'IT Dept 25/26';
  const apiKey = process.env.BREVO_SMTP_PASSWORD || await getSetting('brevoApiKey') || await getSetting('brevoSmtpPassword');

  const transporter = await createTransporter();

  const mailOptions = {
    from: `"${senderName}" <${senderEmail}>`,
    to,
    subject,
    html,
    text: text || html.replace(/<[^>]+>/g, '')
  };

  if (transporter) {
    try {
      const info = await transporter.sendMail(mailOptions);
      console.log(`✉️ Email sent to ${to} via Brevo SMTP. Message ID: ${info.messageId}`);
      return info;
    } catch (err) {
      console.warn(`⚠️ Brevo SMTP error (${err.message}). Auto-switching to Brevo HTTP v3 REST API...`);
    }
  }

  // Automatic Fallback: Brevo HTTP v3 REST API
  if (apiKey) {
    return await sendViaBrevoApi({
      to,
      subject,
      html,
      text,
      senderEmail,
      senderName,
      apiKey
    });
  }

  throw new Error('Brevo credentials missing. Please set BREVO_SMTP_PASSWORD in .env or Admin Settings.');
}

/**
 * Send Admin Alert Email (e.g. WhatsApp logout notification)
 */
async function sendAdminAlertEmail(subject, message) {
  const adminEmail = process.env.BREVO_SENDER_EMAIL || process.env.ADMIN_EMAIL;
  if (!adminEmail) return;
  const html = `<div style="font-family: sans-serif; padding: 20px;"><h2>${subject}</h2><p>${message}</p></div>`;
  return sendEmail({ to: adminEmail, subject, html });
}

module.exports = {
  sendEmail,
  sendAdminAlertEmail,
  renderTemplate
};
