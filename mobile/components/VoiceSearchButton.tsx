import React, { useState } from 'react';
import { TouchableOpacity, Text, StyleSheet, Alert } from 'react-native';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { colors } from '../theme';

interface Props {
  onResult: (transcript: string) => void;
  lang?: string;
}

export default function VoiceSearchButton({ onResult, lang = 'am-ET' }: Props) {
  const [listening, setListening] = useState(false);

  useSpeechRecognitionEvent('start', () => setListening(true));
  useSpeechRecognitionEvent('end', () => setListening(false));
  useSpeechRecognitionEvent('result', event => {
    const transcript = event.results[0]?.transcript;
    if (transcript) onResult(transcript);
  });
  useSpeechRecognitionEvent('error', event => {
    setListening(false);
    if (event.error !== 'no-speech' && event.error !== 'aborted') {
      Alert.alert('Voice search error', event.message || event.error);
    }
  });

  const handlePress = async () => {
    if (listening) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!result.granted) {
      Alert.alert('Microphone permission needed', 'Voice search needs microphone access to work.');
      return;
    }
    ExpoSpeechRecognitionModule.start({
      lang,
      interimResults: true,
      continuous: false,
    });
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      style={[styles.button, listening && styles.buttonActive]}
      accessibilityLabel={listening ? 'Stop voice search' : 'Start voice search'}
    >
      <Text style={styles.icon}>{listening ? '⏹' : '🎤'}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
  },
  buttonActive: {
    backgroundColor: colors.accent,
  },
  icon: {
    fontSize: 20,
  },
});
