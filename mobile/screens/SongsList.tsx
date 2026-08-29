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

export default function SongsList({ route, navigation }: Props) {
  const { singerId, singerName, query = '' } = route.params;
  const { songs } = useLibrary();

  const singerSongs = useMemo(
    () => songs.filter(s => s.singer_id === singerId),
    [songs, singerId]
  );

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
      {item.youtube_video_id ? (
        <MaterialCommunityIcons name="youtube" size={18} color="#FF0000" style={styles.youtubeIcon} />
      ) : null}
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
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
  youtubeIcon: { marginLeft: 8 },
  empty: { textAlign: 'center', marginTop: 24, color: colors.textSecondary },
});
