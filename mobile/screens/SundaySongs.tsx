import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet, Share, Alert, TextInput } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useLibrary } from '../context/LibraryContext';
import { useAuth } from '../context/AuthContext';
import { getSundaySongs, getCanExport, saveSundayOrder } from '../lib/api';
import type { SundaySong } from '../lib/api';
import { saveSundayHtml, savedSundayDate } from '../lib/sundayOffline';
import { formatSundayDate } from '../lib/sundayDates';
import SundayPicker from '../components/SundayPicker';
import { colors } from '../theme';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

export default function SundaySongs() {
  const navigation = useNavigation<NavProp>();
  const { songs: librarySongs } = useLibrary();
  const [date, setDate] = useState<string | null>(null);
  const [songs, setSongs] = useState<SundaySong[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [savedDate, setSavedDate] = useState<string | null>(null);
  // null = the nearest Sunday (the server's default); otherwise a Sunday picked from the list.
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const { session } = useAuth();
  const [canOrder, setCanOrder] = useState(false);
  // Position typed in each row's box, by songId; only changed rows have an entry.
  const [orderInputs, setOrderInputs] = useState<Record<string, string>>({});
  const [savingOrder, setSavingOrder] = useState(false);

  // Users with Export to Drive rights (and admins) can reorder the list.
  useEffect(() => {
    if (!session) {
      setCanOrder(false);
      return;
    }
    let cancelled = false;
    getCanExport(session.access_token).then(ok => {
      if (!cancelled) setCanOrder(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [session?.access_token]);

  const orderChanged = Object.keys(orderInputs).length > 0;

  // Sorts by the typed numbers (untouched rows keep their current number); on a tie the
  // song that was higher up stays first. Typing 1 on the last song moves it to the top,
  // and 0 takes a song off this Sunday (after a confirmation).
  const handleUpdateOrder = () => {
    if (!date || !session || savingOrder) return;
    const removeIds = songs.filter(item => parseInt(orderInputs[item.songId] ?? '', 10) === 0).map(item => item.songId);
    if (!removeIds.length) {
      saveOrder(removeIds);
      return;
    }
    Alert.alert(
      'Remove songs?',
      `Remove ${removeIds.length} song${removeIds.length > 1 ? 's' : ''} from this Sunday?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => saveOrder(removeIds) },
      ]
    );
  };

  const saveOrder = async (removeIds: string[]) => {
    if (!date || !session) return;
    const ranked = songs.filter(item => !removeIds.includes(item.songId)).map(item => {
      const index = songs.indexOf(item);
      const typed = parseInt(orderInputs[item.songId] ?? '', 10);
      // A song moved up lands just before the one already at that number, a song moved
      // down just after it - so it ends up exactly at the typed position.
      const rank = Number.isNaN(typed) ? index + 1 : typed < index + 1 ? typed - 0.5 : typed + 0.5;
      return { item, rank, index };
    });
    ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
    const newOrder = ranked.map(r => r.item);
    setSavingOrder(true);
    try {
      await saveSundayOrder(newOrder.map(s => s.songId), date, session.access_token, removeIds);
      setSongs(newOrder);
      setOrderInputs({});
    } catch (err) {
      Alert.alert('Could not update the order', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSavingOrder(false);
    }
  };

  // SundaySong itself doesn't carry youtube_video_id - cross-reference the full library.
  const playableIds = useMemo(() => {
    const byId = new Map(librarySongs.map(s => [s.id, s]));
    return songs.filter(s => byId.get(s.songId)?.youtube_video_id).map(s => s.songId);
  }, [songs, librarySongs]);

  const playAll = () => {
    if (!playableIds.length) return;
    navigation.navigate('SongDetail', { songId: playableIds[0], queue: playableIds, queueIndex: 0 });
  };

  // Same as the website's share: the public lyrics page, which anyone can open in a
  // browser without the app or signing in (a mezmurify:// link only works with the app).
  const handleShare = () => {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL;
    if (!date || !apiUrl) return;
    const url = `${apiUrl}/sunday/${date}`;
    Share.share({ message: `Sunday Songs - ${formatSundayDate(date)}\n${url}`, title: 'Sunday Songs' });
  };

  // Saves the Sunday's lyrics handout inside the app and opens it straight away, so nobody
  // has to look for the file afterwards. The saved copy also opens later without internet.
  const handleDownload = async () => {
    if (!date || downloading) return;
    setDownloading(true);
    try {
      await saveSundayHtml(date);
      navigation.navigate('SundayOffline');
    } catch (err) {
      Alert.alert('Download failed', err instanceof Error ? err.message : 'Could not download the Sunday songs.');
    } finally {
      setDownloading(false);
    }
  };

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getSundaySongs(selectedDate ?? undefined)
      .then(data => {
        setDate(data.date);
        setSongs(data.songs);
        setOrderInputs({});
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : 'Failed to load Sunday songs');
        try {
          setSavedDate(savedSundayDate());
        } catch {
          setSavedDate(null);
        }
      })
      .finally(() => setLoading(false));
  }, [selectedDate]);

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
            onPress={() => navigation.navigate('SundayOffline')}
            style={[styles.downloadButton, styles.offlineButton]}
          >
            <MaterialCommunityIcons name="file-document-outline" size={20} color={colors.accent} />
            <Text style={styles.downloadText}>Open downloaded songs ({formatSundayDate(savedDate)})</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  const songText = (item: SundaySong) => (
    <View style={styles.rowText}>
      <Text style={styles.title} numberOfLines={1}>
        {item.title}
      </Text>
      <Text style={styles.singer} numberOfLines={1}>
        {item.singer}
      </Text>
    </View>
  );

  const openSong = (item: SundaySong) => navigation.navigate('SongDetail', { songId: item.songId });

  // With ordering on, only the title/singer opens the song - the number box and the blank
  // gap next to it don't, so a slightly missed tap on the box doesn't open the lyrics.
  const renderItem = ({ item, index }: { item: SundaySong; index: number }) =>
    canOrder ? (
      <View style={styles.row}>
        <TextInput
          style={[styles.orderInput, orderInputs[item.songId] !== undefined && styles.orderInputChanged]}
          value={orderInputs[item.songId] ?? String(index + 1)}
          onChangeText={text => {
            const digits = text.replace(/[^0-9]/g, '');
            setOrderInputs(prev => {
              const next = { ...prev };
              if (digits === String(index + 1)) delete next[item.songId];
              else next[item.songId] = digits;
              return next;
            });
          }}
          keyboardType="number-pad"
          maxLength={2}
          selectTextOnFocus
          accessibilityLabel={`Position of ${item.title}`}
        />
        <View style={styles.orderGap} />
        <TouchableOpacity style={styles.rowTextTouch} activeOpacity={0.6} onPress={() => openSong(item)}>
          {songText(item)}
        </TouchableOpacity>
      </View>
    ) : (
      <TouchableOpacity style={styles.row} activeOpacity={0.6} onPress={() => openSong(item)}>
        <View style={styles.index}>
          <Text style={styles.indexText}>{index + 1}</Text>
        </View>
        {songText(item)}
      </TouchableOpacity>
    );

  return (
    <View style={styles.container}>
      <SundayPicker
        visible={pickerOpen}
        title="Choose a Sunday"
        selected={date}
        onSelect={picked => {
          setPickerOpen(false);
          setSelectedDate(picked);
        }}
        onClose={() => setPickerOpen(false)}
      />
      {date ? (
        <View style={styles.dateRow}>
          <TouchableOpacity
            style={styles.dateSelect}
            onPress={() => setPickerOpen(true)}
            activeOpacity={0.6}
            accessibilityLabel="Choose a Sunday"
          >
            <Text style={styles.dateHeader} numberOfLines={1}>{formatSundayDate(date)}</Text>
            <MaterialCommunityIcons name="chevron-down" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
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
      {canOrder && songs.length > 1 ? (
        orderChanged ? (
          <View style={styles.orderBar}>
            <TouchableOpacity style={styles.updateOrderButton} onPress={handleUpdateOrder} disabled={savingOrder} activeOpacity={0.7}>
              {savingOrder ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <MaterialCommunityIcons name="sort-numeric-ascending" size={20} color="#fff" />
              )}
              <Text style={styles.playAllText}>Update order</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setOrderInputs({})} disabled={savingOrder} style={styles.cancelOrderButton}>
              <Text style={styles.cancelOrderText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={styles.orderHint}>To reorder, type a song's new number (0 removes it), then tap Update order.</Text>
        )
      ) : null}
      <FlatList
        keyboardShouldPersistTaps="handled"
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
  dateSelect: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    marginRight: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
  },
  dateHeader: { flexShrink: 1, fontSize: 14, fontWeight: '600', color: colors.textPrimary },
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
  orderInput: {
    width: 46,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e0',
    backgroundColor: '#ffffff',
    color: '#1a202c',
    fontWeight: '700',
    fontSize: 16,
    textAlign: 'center',
    padding: 0,
  },
  orderGap: { width: 18 },
  rowTextTouch: { flex: 1, minWidth: 0, alignSelf: 'stretch', justifyContent: 'center' },
  orderInputChanged: { borderColor: colors.accent, borderWidth: 2 },
  orderHint: { color: colors.textSecondary, fontSize: 12, marginHorizontal: 16, marginTop: 10 },
  orderBar: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginTop: 8 },
  updateOrderButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.accent,
    paddingVertical: 10,
    borderRadius: 24,
  },
  cancelOrderButton: { paddingHorizontal: 12, paddingVertical: 10 },
  cancelOrderText: { color: colors.textSecondary, fontWeight: '600' },
  rowText: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, color: colors.textPrimary },
  singer: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  empty: { textAlign: 'center', marginTop: 24, color: colors.textSecondary },
  errorText: { color: colors.error, marginBottom: 12, textAlign: 'center' },
  retryButton: { backgroundColor: colors.accent, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24 },
  retryText: { color: colors.highlightText, fontWeight: '700' },
});
