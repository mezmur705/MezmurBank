const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const CLIENT_PATH = path.resolve(__dirname, '..', '..', 'google-oauth-client-export.json');
const TOKEN_PATH = path.resolve(__dirname, '..', 'google-oauth-token-youtube.json');

function getYoutubeClient() {
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(`Missing ${TOKEN_PATH} - run "node youtube-auth-setup.js" first.`);
  }
  const clientJson = JSON.parse(fs.readFileSync(CLIENT_PATH, 'utf8'));
  const { client_id, client_secret } = clientJson.installed || clientJson.web;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret);
  oAuth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')));
  return google.youtube({ version: 'v3', auth: oAuth2Client });
}

// Uploads videoPath as an unlisted video (safe default - visible only via direct link, doesn't
// spam the channel's public uploads feed). Returns the new video's id.
async function uploadVideo({ videoPath, title, description }) {
  const youtube = getYoutubeClient();
  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: title.slice(0, 100), // YouTube's title length limit
        description: description || '',
        categoryId: '10', // Music
      },
      status: {
        privacyStatus: 'unlisted',
        selfDeclaredMadeForKids: false,
      },
    },
    media: { body: fs.createReadStream(videoPath) },
  });
  return res.data.id;
}

module.exports = { getYoutubeClient, uploadVideo };
