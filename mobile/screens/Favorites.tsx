import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useAuth } from '../context/AuthContext';
import { useLibrary } from '../context/LibraryContext';
import { getFavoriteSongIds } from '../lib/api';
import { colors, colorForId } from '../theme';
import type { SongWithSinger } from '../types/models';

type Props = NativeStackScreenProps<RootStackParamList, 'Favorites'>;

export default function Favorites({ navigation }: Props) {
  const { user } = useAuth();
  const { songs } = useLibrary();
  const [songIds, setSongIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!user) {
      setSongIds([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    getFavoriteSongIds(user.id)
      .then(ids => setSongIds(Array.from(ids)))
      .finally(() => setLoading(false));
  }, [user]);

  useFocusEffect(load);

  const favoriteSongs = useMemo(() => {
    const bySongId = new Map(songs.map(s => [s.id, s]));
    return songIds.map(id => bySongId.get(id)).filter((s): s is SongWithSinger => !!s);
  }, [songIds, songs]);

  if (!user) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>Sign in to see your favorite songs.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

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
      <FlatList
        data={favoriteSongs}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.empty}>No favorite songs yet.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: 24 },
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
