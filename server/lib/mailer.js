// Resend (HTTPS email API), not SMTP - Render's free plan blocks/throttles raw outbound
// SMTP to Gmail (confirmed via repeated ETIMEDOUT connecting on port 465/587 in production
// logs), so this sends over plain HTTPS instead, which isn't blocked. Uses the built-in
// fetch (same as the YouTube Data API calls in server.js), no extra dependency needed.
// Silently no-ops (logs a warning) if the env vars aren't set, so local/dev setups without
// mail configured don't crash.
async function sendNotificationEmail(subject, text) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.NOTIFY_EMAIL_TO;
  const from = process.env.NOTIFY_EMAIL_FROM || 'onboarding@resend.dev';
  if (!apiKey || !to) {
    console.warn(`Email notification skipped (RESEND_API_KEY/NOTIFY_EMAIL_TO not set): ${subject}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text }),
    // Without this, a hung connection (rather than an outright rejection) would neither
    // throw nor deliver - the caller's .catch() would just never fire, indistinguishable
    // from success in the logs. Fail loud instead.
    signal: AbortSignal.timeout(10000),
  });
  const body = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`Resend API error ${res.status}: ${body}`);
  console.log(`Notification email sent via Resend: ${subject} (${body})`);
}

module.exports = { sendNotificationEmail };
