// One-time interactive authorization: obtains a Google Drive refresh token for your own
// account (not a service account) and saves it so match-and-upload-media.js can run unattended.
//
// Prerequisites (do this once in Google Cloud Console, https://console.cloud.google.com/):
//   1. Create/select a project.
//   2. APIs & Services > Library > enable "Google Drive API".
//   3. APIs & Services > OAuth consent screen > User Type "External" > add joely.pizza@gmail.com
//      as a test user (keeps the app in Testing mode, no verification needed for personal use).
//   4. APIs & Services > Credentials > Create Credentials > OAuth client ID > Application type
//      "Desktop app". Download the JSON and save it as server\google-oauth-client.json.
//
// Usage: node drive-auth-setup.js
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const http = require('http');
const { google } = require('googleapis');

const CLIENT_PATH = path.resolve(__dirname, process.env.GOOGLE_OAUTH_CLIENT_PATH || 'google-oauth-client.json');
const TOKEN_PATH = path.resolve(__dirname, process.env.GOOGLE_OAUTH_TOKEN_PATH || 'google-oauth-token.json');
// drive.file only grants access to files the app itself created — it cannot see or write into a
// pre-existing folder no matter how it's shared. Uploading into an existing folder needs full
// Drive access instead.
const SCOPES = ['https://www.googleapis.com/auth/drive'];
const REDIRECT_PORT = 53682;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;

async function main() {
  if (!fs.existsSync(CLIENT_PATH)) {
    console.error(`Missing OAuth client file: ${CLIENT_PATH}`);
    console.error('Download it from Google Cloud Console (Credentials > OAuth client ID, Desktop app type) and save it there.');
    process.exit(1);
  }
  const { client_id, client_secret } = JSON.parse(fs.readFileSync(CLIENT_PATH, 'utf8')).installed
    || JSON.parse(fs.readFileSync(CLIENT_PATH, 'utf8')).web;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI);

  const authUrl = oAuth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== '/oauth2callback') { res.end(); return; }
      const returnedCode = url.searchParams.get('code');
      res.end(returnedCode ? 'Authorized. You can close this tab and return to the terminal.' : 'No code received.');
      server.close();
      returnedCode ? resolve(returnedCode) : reject(new Error('No code in callback'));
    });
    server.listen(REDIRECT_PORT, () => {
      // Synchronous write: console.log's stream can stay buffered indefinitely once the
      // event loop is otherwise idle waiting on the HTTP callback below, on Windows.
      fs.writeSync(1, `Open this URL in your browser and sign in as joely.pizza@gmail.com:\n\n${authUrl}\n\nWaiting for the browser redirect on ${REDIRECT_URI} ...\n`);
    });
  });

  const { tokens } = await oAuth2Client.getToken(code);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log(`Saved refresh token to ${TOKEN_PATH}`);
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
