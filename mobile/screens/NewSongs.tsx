import React, { useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useLibrary } from '../context/LibraryContext';
import { colors, colorForId } from '../theme';
import type { SongWithSinger } from '../types/models';

type Props = NativeStackScreenProps<RootStackParamList, 'NewSongs'>;

const NEW_BADGE_DAYS = 30;
function isNewSong(song: SongWithSinger): boolean {
  const ageMs = Date.now() - new Date(song.created_at).getTime();
  return ageMs < NEW_BADGE_DAYS * 24 * 60 * 60 * 1000;
}

export default function NewSongs({ navigation }: Props) {
  const { songs } = useLibrary();

  const newSongs = useMemo(
    () =>
      songs
        .filter(isNewSong)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [songs]
  );

  const playableIds = useMemo(
    () => newSongs.filter(s => s.youtube_video_id).map(s => s.id),
    [newSongs]
  );

  const playAll = () => {
    if (!playableIds.length) return;
    navigation.navigate('SongDetail', { songId: playableIds[0], queue: playableIds, queueIndex: 0 });
  };

  const renderItem = ({ item }: { item: SongWithSinger }) => (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.6}
      onPress={() => navigation.navigate('SongDetail', { songId: item.id })}
    >
      <View style={[styles.index, { backgroundColor: colorForId(item.id) }]}>
        <Text style={styles.indexText}>{item.title.charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.rowText}>
        <Text style={styles.title}>{item.title}</Text>
        <Text style={styles.subtitle}>{item.singers?.name}</Text>
      </View>
      {item.youtube_video_id ? (
        <MaterialCommunityIcons name="youtube" size={18} color="#FF0000" style={styles.youtubeIcon} />
      ) : null}
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.hint}>Added in the last {NEW_BADGE_DAYS} days.</Text>
      {playableIds.length > 0 ? (
        <TouchableOpacity style={styles.playAllButton} onPress={playAll} activeOpacity={0.7}>
          <MaterialCommunityIcons name="play-circle" size={20} color="#fff" />
          <Text style={styles.playAllText}>Play All ({playableIds.length})</Text>
        </TouchableOpacity>
      ) : null}
      <FlatList
        data={newSongs}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.empty}>No new songs in the last {NEW_BADGE_DAYS} days.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  hint: { fontSize: 13, color: colors.textSecondary, paddingHorizontal: 16, paddingTop: 12 },
  playAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.accent,
    marginHorizontal: 16,
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 24,
  },
  playAllText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  listContent: { paddingVertical: 8, paddingBottom: 24 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 12 },
  index: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  indexText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  rowText: { flex: 1 },
  title: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  youtubeIcon: { marginLeft: 8 },
  empty: { textAlign: 'center', marginTop: 24, color: colors.textSecondary },
});
