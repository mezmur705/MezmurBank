import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { colors } from '../theme';

export default function SignInSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);

  const handle = async () => {
    setBusy(true);
    try {
      await signInWithGoogle();
      onClose();
    } catch (err) {
      Alert.alert('Sign-in failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Sign in</Text>
          <Text style={styles.subtitle}>Sign in to save favorites, comment, and sync your recently viewed songs.</Text>

          <TouchableOpacity
            style={styles.button}
            onPress={handle}
            disabled={busy}
            accessibilityLabel="Continue with Google"
          >
            {busy ? (
              <ActivityIndicator color={colors.textPrimary} />
            ) : (
              <>
                <MaterialIcons name="login" size={20} color={colors.textPrimary} />
                <Text style={styles.buttonText}>Continue with Google</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancel} onPress={onClose} disabled={busy}>
            <Text style={styles.cancelText}>Not now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 36 },
  title: { fontSize: 20, fontWeight: '800', color: colors.textPrimary, marginBottom: 6 },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginBottom: 20 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: 24,
    paddingVertical: 14,
    marginBottom: 12,
  },
  buttonText: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
  cancel: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  cancelText: { color: colors.textSecondary, fontSize: 14 },
});
