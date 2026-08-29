import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useLibrary } from '../context/LibraryContext';
import { filterSongs } from '../lib/search';
import VoiceSearchButton from '../components/VoiceSearchButton';
import HighlightText from '../components/HighlightText';
import { colors, colorForId } from '../theme';
import type { Singer, SongWithSinger } from '../types/models';

type Props = NativeStackScreenProps<RootStackParamList, 'SingersList'>;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function Avatar({ id, label, twoLetter }: { id: number | string; label: string; twoLetter?: boolean }) {
  return (
    <View style={[styles.avatar, { backgroundColor: colorForId(id) }]}>
      <Text style={styles.avatarText}>{twoLetter ? initials(label) : label.charAt(0).toUpperCase()}</Text>
    </View>
  );
}

export default function SingersList({ navigation }: Props) {
  const { singers, songs, loading, error, refresh } = useLibrary();
  const [query, setQuery] = useState('');
  const trimmedQuery = query.trim();

  const songCountBySinger = useMemo(() => {
    const counts = new Map<number, number>();
    for (const song of songs) {
      counts.set(song.singer_id, (counts.get(song.singer_id) ?? 0) + 1);
    }
    return counts;
  }, [songs]);

  const matchingSongs = useMemo(() => {
    if (!trimmedQuery) return [];
    return filterSongs(songs, trimmedQuery);
  }, [songs, trimmedQuery]);

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
        <TouchableOpacity onPress={refresh} style={styles.retryButton}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const renderSinger = ({ item }: { item: Singer }) => (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.6}
      onPress={() => navigation.navigate('SongsList', { singerId: item.id, singerName: item.name })}
    >
      <Avatar id={item.id} label={item.name} twoLetter />
      <View style={styles.rowText}>
        <Text style={styles.name}>{item.name}</Text>
        {item.amharic_name ? <Text style={styles.subtitle}>{item.amharic_name}</Text> : null}
      </View>
      <Text style={styles.count}>{songCountBySinger.get(item.id) ?? 0}</Text>
    </TouchableOpacity>
  );

  const renderSong = ({ item }: { item: SongWithSinger }) => (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.6}
      onPress={() => navigation.navigate('SongDetail', { songId: item.id, query: trimmedQuery })}
    >
      <Avatar id={item.id} label={item.title} />
      <View style={styles.rowText}>
        <HighlightText text={item.title} query={trimmedQuery} style={styles.name} />
        <Text style={styles.subtitle}>
          {item.singers?.name}
          {item.singers?.amharic_name ? `  •  ${item.singers.amharic_name}` : ''}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.search}
          placeholder="Search singers or songs..."
          placeholderTextColor={colors.textTertiary}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
        />
        <VoiceSearchButton onResult={setQuery} />
      </View>
      {trimmedQuery ? (
        <FlatList
          data={matchingSongs}
          keyExtractor={item => item.id}
          renderItem={renderSong}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<Text style={styles.empty}>No songs found.</Text>}
        />
      ) : (
        <FlatList
          data={singers}
          keyExtractor={item => String(item.id)}
          renderItem={renderSinger}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    gap: 10,
  },
  search: {
    flex: 1,
    height: 46,
    paddingHorizontal: 16,
    borderRadius: 23,
    backgroundColor: colors.card,
    color: colors.textPrimary,
    fontSize: 15,
  },
  listContent: { paddingBottom: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 18 },
  rowText: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  count: { fontSize: 13, color: colors.textTertiary },
  errorText: { color: colors.error, marginBottom: 12, textAlign: 'center', paddingHorizontal: 24 },
  retryButton: { backgroundColor: colors.accent, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24 },
  retryText: { color: colors.highlightText, fontWeight: '700' },
  empty: { textAlign: 'center', marginTop: 24, color: colors.textSecondary },
});
