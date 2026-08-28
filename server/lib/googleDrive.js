const { google } = require('googleapis');

// Personal-account OAuth (same pattern as drive-auth-setup.js/match-and-upload-media.js, but a
// separate credential pair - that script's token is authorized as joely.pizza@gmail.com for the
// unrelated one-time Telegram media import; this one is authorized as mezmur705@gmail.com, the
// actual owner of the OpenSong-export target folder. A service account was tried first but can't
// work here: service accounts have no storage quota of their own, and this Google account turned
// out to be a personal account (no Shared Drives available to work around that).
//
// Credentials live as JSON-string env vars (not files) so they deploy cleanly to Render, which
// only gets what's in git - these files are gitignored like every other credential here.
function getDriveClient() {
  const { client_id, client_secret } = JSON.parse(process.env.GOOGLE_DRIVE_EXPORT_CLIENT_JSON).installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret);
  oAuth2Client.setCredentials(JSON.parse(process.env.GOOGLE_DRIVE_EXPORT_TOKEN_JSON));
  return google.drive({ version: 'v3', auth: oAuth2Client });
}

module.exports = { getDriveClient };
