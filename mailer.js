const nodemailer = require('nodemailer');
const { getSetting } = require('./database');

async function createTransporter() {
  const host = process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com';
  const port = parseInt(process.env.BREVO_SMTP_PORT || '587', 10);
  const user = process.env.BREVO_SMTP_USER || await getSetting('brevoSmtpUser');
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
 * Send Email via Brevo SMTP
 */
async function sendEmail({ to, subject, html, text }) {
  const transporter = await createTransporter();
  const senderEmail = process.env.BREVO_SENDER_EMAIL || await getSetting('brevoSenderEmail') || process.env.BREVO_SMTP_USER;
  const senderName = process.env.BREVO_SENDER_NAME || await getSetting('brevoSenderName') || 'IT Dept 25/26';

  if (!transporter) {
    throw new Error('Brevo SMTP credentials not configured. Please set BREVO_SMTP_USER and BREVO_SMTP_PASSWORD in .env or Admin Settings.');
  }

  const mailOptions = {
    from: `"${senderName}" <${senderEmail || 'no-reply@itdept2526.org'}>`,
    to,
    subject,
    html,
    text: text || html.replace(/<[^>]+>/g, '')
  };

  const info = await transporter.sendMail(mailOptions);
  console.log(`✉️ Email sent to ${to} via Brevo. Message ID: ${info.messageId}`);
  return info;
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
