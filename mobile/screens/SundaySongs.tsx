import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { getSundaySongs } from '../lib/api';
import type { SundaySong } from '../lib/api';
import { colors } from '../theme';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

function formatSundayDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export default function SundaySongs() {
  const navigation = useNavigation<NavProp>();
  const [date, setDate] = useState<string | null>(null);
  const [songs, setSongs] = useState<SundaySong[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getSundaySongs()
      .then(data => {
        setDate(data.date);
        setSongs(data.songs);
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load Sunday songs'))
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

  const renderItem = ({ item, index }: { item: SundaySong; index: number }) => (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.6}
      onPress={() => navigation.navigate('SongDetail', { songId: item.songId })}
    >
      <View style={styles.index}>
        <Text style={styles.indexText}>{index + 1}</Text>
      </View>
      <View style={styles.rowText}>
        <Text style={styles.title} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.singer} numberOfLines={1}>
          {item.singer}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {date ? <Text style={styles.dateHeader}>{formatSundayDate(date)}</Text> : null}
      <FlatList
        data={songs}
        keyExtractor={item => item.songId}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.empty}>No songs added for this Sunday yet.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: 24 },
  dateHeader: { fontSize: 14, fontWeight: '600', color: colors.textSecondary, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  listContent: { paddingVertical: 8, paddingBottom: 24 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 14 },
  index: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indexText: { color: colors.textPrimary, fontWeight: '700', fontSize: 13 },
  rowText: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, color: colors.textPrimary },
  singer: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  empty: { textAlign: 'center', marginTop: 24, color: colors.textSecondary },
  errorText: { color: colors.error, marginBottom: 12, textAlign: 'center' },
  retryButton: { backgroundColor: colors.accent, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24 },
  retryText: { color: colors.highlightText, fontWeight: '700' },
});
