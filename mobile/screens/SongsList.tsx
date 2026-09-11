import React, { useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useLibrary } from '../context/LibraryContext';
import HighlightText from '../components/HighlightText';
import { colors, colorForId } from '../theme';
import type { SongWithSinger } from '../types/models';

type Props = NativeStackScreenProps<RootStackParamList, 'SongsList'>;

const NEW_BADGE_DAYS = 30;
function isNewSong(song: SongWithSinger): boolean {
  const ageMs = Date.now() - new Date(song.created_at).getTime();
  return ageMs < NEW_BADGE_DAYS * 24 * 60 * 60 * 1000;
}

export default function SongsList({ route, navigation }: Props) {
  const { singerId, singerName, query = '' } = route.params;
  const { songs } = useLibrary();

  const singerSongs = useMemo(
    () => songs.filter(s => s.singer_id === singerId),
    [songs, singerId]
  );

  const playableIds = useMemo(
    () => singerSongs.filter(s => s.youtube_video_id).map(s => s.id),
    [singerSongs]
  );

  const playAll = () => {
    if (!playableIds.length) return;
    navigation.navigate('SongDetail', { songId: playableIds[0], query, queue: playableIds, queueIndex: 0 });
  };

  const renderItem = ({ item, index }: { item: SongWithSinger; index: number }) => (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.6}
      onPress={() => navigation.navigate('SongDetail', { songId: item.id, query })}
    >
      <View style={[styles.index, { backgroundColor: colorForId(item.id) }]}>
        <Text style={styles.indexText}>{index + 1}</Text>
      </View>
      <HighlightText text={item.title} query={query} style={styles.title} />
      {isNewSong(item) ? (
        <View style={styles.newBadge}>
          <Text style={styles.newBadgeText}>NEW</Text>
        </View>
      ) : null}
      {item.youtube_video_id ? (
        <MaterialCommunityIcons name="youtube" size={18} color="#FF0000" style={styles.youtubeIcon} />
      ) : null}
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {playableIds.length > 0 ? (
        <TouchableOpacity style={styles.playAllButton} onPress={playAll} activeOpacity={0.7}>
          <MaterialCommunityIcons name="play-circle" size={20} color="#fff" />
          <Text style={styles.playAllText}>Play All ({playableIds.length})</Text>
        </TouchableOpacity>
      ) : null}
      <FlatList
        data={singerSongs}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <Text style={styles.empty}>No songs found for {singerName}.</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 14,
  },
  index: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indexText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  title: { fontSize: 16, color: colors.textPrimary, flex: 1 },
  newBadge: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginLeft: 8,
  },
  newBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  youtubeIcon: { marginLeft: 8 },
  empty: { textAlign: 'center', marginTop: 24, color: colors.textSecondary },
});
