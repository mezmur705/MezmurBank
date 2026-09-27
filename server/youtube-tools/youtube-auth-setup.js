// One-time interactive authorization: obtains a YouTube-upload refresh token for
// mezmur705@gmail.com, reusing the same OAuth client already created for the Drive export
// feature (same Google Cloud project, mezmurify-506908) - just a different scope, so a
// separate token file.
//
// Prerequisites (do this once in Google Cloud Console, https://console.cloud.google.com/,
// project mezmurify-506908 - the one already used for Drive export):
//   1. APIs & Services > Library > enable "YouTube Data API v3".
//   2. APIs & Services > OAuth consent screen > Data Access / Scopes > add scope
//      ".../auth/youtube.upload" (it's a "sensitive" scope, but Testing-mode apps with
//      mezmur705@gmail.com already added as a test user don't need Google's verification).
//   3. Confirm mezmur705@gmail.com is still listed under "Test users".
//
// Usage: node youtube-auth-setup.js
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const http = require('http');
const { google } = require('googleapis');

// Reuses the Drive export OAuth client on purpose - same project, same account, avoids
// creating yet another OAuth client in the Cloud Console.
const CLIENT_PATH = path.resolve(__dirname, '..', 'google-oauth-client-export.json');
const TOKEN_PATH = path.resolve(__dirname, 'google-oauth-token-youtube.json');
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload'];
const REDIRECT_PORT = 53683; // different port than drive-auth-setup.js, in case both are run close together
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;

async function main() {
  if (!fs.existsSync(CLIENT_PATH)) {
    console.error(`Missing OAuth client file: ${CLIENT_PATH}`);
    console.error('This should already exist from the Drive export setup - see server/lib/googleDrive.js.');
    process.exit(1);
  }
  const clientJson = JSON.parse(fs.readFileSync(CLIENT_PATH, 'utf8'));
  const { client_id, client_secret } = clientJson.installed || clientJson.web;
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
      fs.writeSync(1, `Open this URL in your browser and sign in as mezmur705@gmail.com:\n\n${authUrl}\n\nWaiting for the browser redirect on ${REDIRECT_URI} ...\n`);
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
