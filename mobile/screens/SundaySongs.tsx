import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet, Share, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useLibrary } from '../context/LibraryContext';
import { getSundaySongs } from '../lib/api';
import type { SundaySong } from '../lib/api';
import { saveSundayHtml, latestSavedSundayDate } from '../lib/sundayOffline';
import { colors } from '../theme';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

function formatSundayDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export default function SundaySongs() {
  const navigation = useNavigation<NavProp>();
  const { songs: librarySongs } = useLibrary();
  const [date, setDate] = useState<string | null>(null);
  const [songs, setSongs] = useState<SundaySong[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [savedDate, setSavedDate] = useState<string | null>(null);

  // SundaySong itself doesn't carry youtube_video_id - cross-reference the full library.
  const playableIds = useMemo(() => {
    const byId = new Map(librarySongs.map(s => [s.id, s]));
    return songs.filter(s => byId.get(s.songId)?.youtube_video_id).map(s => s.songId);
  }, [songs, librarySongs]);

  const playAll = () => {
    if (!playableIds.length) return;
    navigation.navigate('SongDetail', { songId: playableIds[0], queue: playableIds, queueIndex: 0 });
  };

  // Uses the app's own mezmurify:// scheme (wired up via the linking config in
  // App.tsx) so tapping the link opens this screen directly in the mobile app.
  const handleShare = () => {
    if (!date) return;
    Share.share({ message: 'mezmurify://sunday', title: 'Sunday Songs' });
  };

  // Saves the Sunday's lyrics handout inside the app and opens it straight away, so nobody
  // has to look for the file afterwards. The saved copy also opens later without internet.
  const handleDownload = async () => {
    if (!date || downloading) return;
    setDownloading(true);
    try {
      await saveSundayHtml(date);
      navigation.navigate('SundayOffline', { date });
    } catch (err) {
      Alert.alert('Download failed', err instanceof Error ? err.message : 'Could not download the Sunday songs.');
    } finally {
      setDownloading(false);
    }
  };

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getSundaySongs()
      .then(data => {
        setDate(data.date);
        setSongs(data.songs);
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : 'Failed to load Sunday songs');
        try {
          setSavedDate(latestSavedSundayDate());
        } catch {
          setSavedDate(null);
        }
      })
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
        {savedDate ? (
          <TouchableOpacity
            onPress={() => navigation.navigate('SundayOffline', { date: savedDate })}
            style={[styles.downloadButton, styles.offlineButton]}
          >
            <MaterialCommunityIcons name="file-document-outline" size={20} color={colors.accent} />
            <Text style={styles.downloadText}>Open downloaded songs ({formatSundayDate(savedDate)})</Text>
          </TouchableOpacity>
        ) : null}
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
      {date ? (
        <View style={styles.dateRow}>
          <Text style={styles.dateHeader}>{formatSundayDate(date)}</Text>
          <TouchableOpacity onPress={handleShare} accessibilityLabel="Share this Sunday's songs">
            <MaterialCommunityIcons name="share-variant" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      ) : null}
      {playableIds.length > 0 ? (
        <TouchableOpacity style={styles.playAllButton} onPress={playAll} activeOpacity={0.7}>
          <MaterialCommunityIcons name="play-circle" size={20} color="#fff" />
          <Text style={styles.playAllText}>Play All ({playableIds.length})</Text>
        </TouchableOpacity>
      ) : null}
      {date && songs.length > 0 ? (
        <TouchableOpacity style={styles.downloadButton} onPress={handleDownload} activeOpacity={0.7} disabled={downloading}>
          {downloading ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <MaterialCommunityIcons name="download" size={20} color={colors.accent} />
          )}
          <Text style={styles.downloadText}>Download Sunday Songs</Text>
        </TouchableOpacity>
      ) : null}
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
  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  dateHeader: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  playAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.accent,
    marginHorizontal: 16,
    marginTop: 8,
    paddingVertical: 10,
    borderRadius: 24,
  },
  playAllText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.accent,
    marginHorizontal: 16,
    marginTop: 8,
    paddingVertical: 10,
    borderRadius: 24,
  },
  downloadText: { color: colors.accent, fontWeight: '700', fontSize: 14 },
  offlineButton: { marginTop: 16, paddingHorizontal: 16, alignSelf: 'stretch' },
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
