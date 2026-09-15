const nodemailer = require('nodemailer');

// Gmail SMTP + App Password - deliberately simpler than the OAuth setup in googleDrive.js,
// since this is just low-volume notification email, not a user-facing feature. Silently
// no-ops (logs a warning) if the env vars aren't set, so local/dev setups without mail
// configured don't crash.
let transporter;
function getTransporter() {
  if (transporter !== undefined) return transporter;
  transporter = (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD)
    ? nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
      })
    : null;
  return transporter;
}

async function sendNotificationEmail(subject, text) {
  const t = getTransporter();
  const to = process.env.NOTIFY_EMAIL_TO;
  if (!t || !to) {
    console.warn(`Email notification skipped (GMAIL_USER/GMAIL_APP_PASSWORD/NOTIFY_EMAIL_TO not set): ${subject}`);
    return;
  }
  await t.sendMail({ from: process.env.GMAIL_USER, to, subject, text });
}

module.exports = { sendNotificationEmail };
