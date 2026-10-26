import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Linking } from 'react-native';
import { WebView } from 'react-native-webview';
import { readSundayHtml } from '../lib/sundayOffline';
import { colors } from '../theme';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://mezmurify.com';

// Shows a downloaded Sunday Songs handout from the phone's storage, so it works offline.
export default function SundayOffline() {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    readSundayHtml()
      .then(setHtml)
      .catch(() => setError('Could not open the downloaded Sunday songs.'));
  }, []);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }
  if (html === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }
  return (
    <WebView
      originWhitelist={['*']}
      // YouTube's embedded player refuses to play on a page without a web address, so the
      // saved file is shown as if it came from the site.
      source={{ html, baseUrl: BASE_URL }}
      style={styles.webview}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      allowsFullscreenVideo
      // The inline player (an iframe) loads inside the page; links the user taps, like
      // "Watch on YouTube", open in the YouTube app/browser instead of inside this viewer.
      onShouldStartLoadWithRequest={request => {
        if (request.isTopFrame === false) return true;
        if (/^https?:/.test(request.url) && !request.url.startsWith(BASE_URL)) {
          Linking.openURL(request.url);
          return false;
        }
        return true;
      }}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: 24 },
  errorText: { color: colors.error, textAlign: 'center' },
  webview: { flex: 1, backgroundColor: colors.background },
});
