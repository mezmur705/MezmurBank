import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet, Linking } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { getDriveExports } from '../lib/api';
import { colors } from '../theme';
import type { DriveExport } from '../lib/api';

export default function DriveExports() {
  const [files, setFiles] = useState<DriveExport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getDriveExports()
      .then(setFiles)
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load exported files'))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(load);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity onPress={load} style={styles.retryButton}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const renderItem = ({ item }: { item: DriveExport }) => (
    <TouchableOpacity style={styles.row} activeOpacity={0.6} onPress={() => Linking.openURL(item.webViewLink)}>
      <View style={styles.icon}>
        <MaterialIcons name="description" size={22} color={colors.textPrimary} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.name} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.date}>{new Date(item.createdTime).toLocaleString()}</Text>
      </View>
      <MaterialIcons name="open-in-new" size={18} color={colors.textTertiary} />
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={files}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.empty}>No files exported to Drive yet.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: 24 },
  listContent: { paddingVertical: 8, paddingBottom: 24 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  date: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  empty: { textAlign: 'center', marginTop: 24, color: colors.textSecondary },
  errorText: { color: colors.error, marginBottom: 12, textAlign: 'center' },
  retryButton: { backgroundColor: colors.accent, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24 },
  retryText: { color: colors.highlightText, fontWeight: '700' },
});
