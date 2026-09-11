// Drops the one-time Play Console "App Developer Identity" verification snippet into the
// generated Android project's assets folder, so a build made with this plugin active proves
// ownership of both the signing key and this source tree. Safe to remove once package name
// registration for com.mezmur705.mobile is confirmed by Google.
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const ADI_SNIPPET = 'CPP5K3UL7ITY4AAAAAAAAAAAAA';

module.exports = function withAdiRegistration(config) {
  return withDangerousMod(config, [
    'android',
    async config => {
      const assetsDir = path.join(config.modRequest.platformProjectRoot, 'app', 'src', 'main', 'assets');
      fs.mkdirSync(assetsDir, { recursive: true });
      fs.writeFileSync(path.join(assetsDir, 'adi-registration.properties'), ADI_SNIPPET);
      return config;
    },
  ]);
};
