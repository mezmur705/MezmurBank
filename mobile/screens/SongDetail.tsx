import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, StyleSheet, useWindowDimensions, Share, TouchableOpacity, TextInput, Alert, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import YoutubePlayer, { PLAYER_STATES } from 'react-native-youtube-iframe';
import { MaterialIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useLibrary } from '../context/LibraryContext';
import { useAuth } from '../context/AuthContext';
import {
  getComments,
  postComment,
  isFavorited,
  addFavorite,
  removeFavorite,
  recordRecentlyViewed,
  exportToDrive,
  reactToSong,
  type ReactionType,
} from '../lib/api';
import HighlightText from '../components/HighlightText';
import { colors } from '../theme';
import type { Comment } from '../types/models';

type Props = NativeStackScreenProps<RootStackParamList, 'SongDetail'>;

const NEW_BADGE_DAYS = 30;

const REACTIONS: { key: 'like_count' | 'love_count' | 'haha_count' | 'wow_count' | 'sad_count' | 'angry_count'; type: ReactionType; emoji: string; label: string }[] = [
  { key: 'like_count', type: 'like', emoji: '👍', label: 'Like' },
  { key: 'love_count', type: 'love', emoji: '❤️', label: 'Love' },
  { key: 'haha_count', type: 'haha', emoji: '😂', label: 'Haha' },
  { key: 'wow_count', type: 'wow', emoji: '😮', label: 'Wow' },
  { key: 'sad_count', type: 'sad', emoji: '😢', label: 'Sad' },
  { key: 'angry_count', type: 'angry', emoji: '😠', label: 'Angry' },
];

export default function SongDetail({ route, navigation }: Props) {
  const { songId, query = '', queue, queueIndex = 0 } = route.params;
  const { songs } = useLibrary();
  const { user, session, promptSignIn } = useAuth();
  const { width } = useWindowDimensions();

  const song = useMemo(() => songs.find(s => s.id === songId), [songs, songId]);

  // "Play All" auto-advance: skips any queued song without a video, in case the list
  // changed since the queue was built. Silently stops once nothing playable is left.
  const advanceQueue = () => {
    if (!queue) return;
    for (let nextIndex = queueIndex + 1; nextIndex < queue.length; nextIndex++) {
      const nextSong = songs.find(s => s.id === queue[nextIndex]);
      if (nextSong?.youtube_video_id) {
        navigation.replace('SongDetail', { songId: queue[nextIndex], query, queue, queueIndex: nextIndex });
        return;
      }
    }
    Alert.alert('Playlist finished', 'That was the last song.');
  };

  const stopQueue = () => navigation.replace('SongDetail', { songId, query });

  // Defensive: if the current song in the queue has no video (data changed after the
  // queue was built), don't strand the user on a silent screen - skip past it.
  useEffect(() => {
    if (queue && song && !song.youtube_video_id) advanceQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, song]);

  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [reactedType, setReactedType] = useState<ReactionType | null>(null);
  const [reactionOverrides, setReactionOverrides] = useState<Partial<Record<ReactionType, number>>>({});
  const [commentText, setCommentText] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  const [exportingDrive, setExportingDrive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCommentsLoading(true);
    setCommentsError(null);
    getComments(songId)
      .then(data => {
        if (!cancelled) setComments(data);
      })
      .catch(err => {
        if (!cancelled) setCommentsError(err instanceof Error ? err.message : 'Failed to load comments');
      })
      .finally(() => {
        if (!cancelled) setCommentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [songId]);

  useEffect(() => {
    if (!user) {
      setIsFavorite(false);
      return;
    }
    let cancelled = false;
    isFavorited(user.id, songId).then(value => {
      if (!cancelled) setIsFavorite(value);
    });
    recordRecentlyViewed(user.id, songId).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user, songId]);

  useEffect(() => {
    setReactionOverrides({});
    let cancelled = false;
    AsyncStorage.getItem(`mezmurify_reacted_${songId}`).then(value => {
      if (!cancelled) setReactedType((value as ReactionType) || null);
    });
    return () => {
      cancelled = true;
    };
  }, [songId]);

  // Anonymous, one reaction per song per device - matches the web app's behavior.
  // Tapping the already-active reaction removes it; switching straight to a different one
  // isn't supported (matches the web app), so any other reaction is a no-op while one is set.
  const handleReact = async (type: ReactionType) => {
    const removing = reactedType === type;
    if (reactedType && !removing) return;
    const baseCount = (song?.[`${type}_count` as keyof typeof song] as number) ?? 0;
    const displayedCount = reactionOverrides[type] ?? baseCount;
    const nextCount = Math.max(displayedCount + (removing ? -1 : 1), 0);
    setReactedType(removing ? null : type);
    setReactionOverrides(prev => ({ ...prev, [type]: nextCount }));
    try {
      await reactToSong(songId, type, removing);
      if (removing) await AsyncStorage.removeItem(`mezmurify_reacted_${songId}`);
      else await AsyncStorage.setItem(`mezmurify_reacted_${songId}`, type);
    } catch (err) {
      setReactedType(removing ? type : null);
      setReactionOverrides(prev => ({ ...prev, [type]: displayedCount }));
      Alert.alert('Could not save reaction', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const handleToggleFavorite = async () => {
    if (!user) {
      promptSignIn();
      return;
    }
    setFavoriteBusy(true);
    try {
      if (isFavorite) {
        await removeFavorite(user.id, songId);
        setIsFavorite(false);
      } else {
        await addFavorite(user.id, songId);
        setIsFavorite(true);
      }
    } catch (err) {
      Alert.alert('Could not update favorite', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setFavoriteBusy(false);
    }
  };

  const handlePostComment = async () => {
    if (!user) {
      promptSignIn();
      return;
    }
    const text = commentText.trim();
    if (!text) return;
    setPostingComment(true);
    try {
      const author = user.user_metadata?.full_name || user.user_metadata?.name || user.email || 'Anonymous';
      await postComment(songId, user.id, author, text);
      setCommentText('');
      const updated = await getComments(songId);
      setComments(updated);
    } catch (err) {
      Alert.alert('Could not post comment', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setPostingComment(false);
    }
  };

  const handleExportToDrive = async () => {
    if (!user || !session) {
      promptSignIn();
      return;
    }
    setExportingDrive(true);
    try {
      const { webViewLink, updated, sundayDate } = await exportToDrive(songId, session.access_token);
      const base = updated
        ? 'This song was already on Drive - the file was updated.'
        : 'The OpenSong-format file was saved to Drive.';
      Alert.alert(
        updated ? 'Already exported' : 'Exported',
        sundayDate ? `${base} Added to the Sunday Songs list for ${sundayDate}.` : base,
        [
          { text: 'Open', onPress: () => Linking.openURL(webViewLink) },
          { text: 'OK' },
        ]
      );
    } catch (err) {
      Alert.alert('Export failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setExportingDrive(false);
    }
  };

  if (!song) {
    return (
      <View style={styles.center}>
        <Text style={styles.notFound}>Song not found.</Text>
      </View>
    );
  }

  const handleShare = () => {
    const singerLine = [song.singers?.name, song.singers?.amharic_name].filter(Boolean).join(' • ');
    const openSongIdLine = song.open_song_id != null ? `OpenSong ID: ${song.open_song_id}` : undefined;
    const youtubeLine = song.youtube_video_id
      ? `https://www.youtube.com/watch?v=${song.youtube_video_id}`
      : undefined;
    const message = [
      song.title,
      singerLine,
      openSongIdLine,
      '',
      song.lyrics,
      youtubeLine ? `\n${youtubeLine}` : undefined,
      '',
      'Shared from Mezmurify',
    ]
      .filter(line => line !== undefined)
      .join('\n');
    Share.share({ message, title: song.title });
  };

  const isNew = Date.now() - new Date(song.created_at).getTime() < NEW_BADGE_DAYS * 24 * 60 * 60 * 1000;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.titleRow}>
        <HighlightText text={song.title} query={query} style={styles.title} numberOfLines={1} ellipsizeMode="tail" />
        {isNew ? (
          <View style={styles.newBadge}>
            <Text style={styles.newBadgeText}>NEW</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.singer}>
        {song.singers?.name}
        {song.singers?.amharic_name ? `  •  ${song.singers.amharic_name}` : ''}
      </Text>
      {song.source_url ? (
        <Text style={styles.sourceCredit} onPress={() => Linking.openURL(song.source_url!)}>
          Source: {song.source_name || 'External source'} (CC BY-SA)
        </Text>
      ) : null}

      {queue ? (
        <View style={styles.queueBar}>
          <Text style={styles.queueText}>Playing {queueIndex + 1} of {queue.length}</Text>
          <TouchableOpacity onPress={advanceQueue}>
            <Text style={styles.queueAction}>Skip ⏭</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={stopQueue}>
            <Text style={styles.queueAction}>Stop ■</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {song.youtube_video_id ? (
        <View style={styles.playerWrap}>
          <YoutubePlayer
            height={(width - 32) * 0.5625}
            videoId={song.youtube_video_id}
            play={!!queue}
            forceAndroidAutoplay
            onChangeState={(state: PLAYER_STATES) => {
              if (state === PLAYER_STATES.ENDED) advanceQueue();
            }}
          />
        </View>
      ) : null}

      <View style={styles.iconRow}>
        <TouchableOpacity
          onPress={handleToggleFavorite}
          style={styles.shareButton}
          accessibilityLabel={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          disabled={favoriteBusy}
        >
          {favoriteBusy ? (
            <ActivityIndicator size="small" color={colors.textPrimary} />
          ) : (
            <MaterialIcons
              name={isFavorite ? 'favorite' : 'favorite-border'}
              size={20}
              color={isFavorite ? colors.error : colors.textPrimary}
            />
          )}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleExportToDrive}
          style={styles.shareButton}
          accessibilityLabel="Export to Drive"
          disabled={exportingDrive}
        >
          {exportingDrive ? (
            <ActivityIndicator size="small" color={colors.textPrimary} />
          ) : (
            <MaterialIcons name="cloud-upload" size={20} color={colors.textPrimary} />
          )}
        </TouchableOpacity>
        <TouchableOpacity onPress={handleShare} style={styles.shareButton} accessibilityLabel="Share song">
          <MaterialIcons name="share" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      <View style={styles.lyricsCard}>
        {song.open_song_id != null ? (
          <Text style={styles.openSongId}>OpenSong ID: {song.open_song_id}</Text>
        ) : null}
        <HighlightText text={song.lyrics} query={query} style={styles.lyrics} />
      </View>

      <View style={styles.statsRow}>
        <Text style={styles.statsLabel}>👁 {song.view_count} views</Text>
      </View>
      <View style={styles.reactionsRow}>
        {REACTIONS.map(r => (
          <TouchableOpacity
            key={r.key}
            style={[styles.reactionItem, reactedType === r.type && styles.reactionItemActive]}
            onPress={() => handleReact(r.type)}
            disabled={!!reactedType && reactedType !== r.type}
            accessibilityLabel={r.label}
          >
            <Text style={styles.reactionEmoji}>{r.emoji}</Text>
            <Text style={styles.reactionCount}>{reactionOverrides[r.type] ?? song[r.key]}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.commentsHeader}>Comments</Text>
      {commentsLoading ? (
        <ActivityIndicator color={colors.accent} />
      ) : commentsError ? (
        <Text style={styles.errorText}>{commentsError}</Text>
      ) : comments.length === 0 ? (
        <Text style={styles.empty}>No comments yet.</Text>
      ) : (
        comments.map(c => (
          <View key={c.id} style={styles.comment}>
            <Text style={styles.commentAuthor}>{c.author}</Text>
            <Text style={styles.commentText}>{c.comment}</Text>
          </View>
        ))
      )}

      <View style={styles.commentComposer}>
        <TextInput
          style={styles.commentInput}
          placeholder={user ? 'Add a comment...' : 'Sign in to comment'}
          placeholderTextColor={colors.textTertiary}
          value={commentText}
          onChangeText={setCommentText}
          onFocus={() => {
            if (!user) promptSignIn();
          }}
          multiline
        />
        <TouchableOpacity
          onPress={handlePostComment}
          style={styles.postButton}
          disabled={postingComment || !commentText.trim()}
          accessibilityLabel="Post comment"
        >
          {postingComment ? (
            <ActivityIndicator size="small" color={colors.textPrimary} />
          ) : (
            <MaterialIcons name="send" size={20} color={colors.textPrimary} />
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  notFound: { color: colors.textPrimary },
  content: { padding: 16, paddingBottom: 40 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: '800', color: colors.textPrimary, flexShrink: 1 },
  newBadge: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginLeft: 8,
  },
  newBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  iconRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  shareButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  singer: { fontSize: 15, color: colors.textSecondary, marginTop: 4, marginBottom: 16 },
  sourceCredit: { fontSize: 12, color: colors.textSecondary, marginTop: -12, marginBottom: 16, textDecorationLine: 'underline' },
  playerWrap: { marginBottom: 16, borderRadius: 8, overflow: 'hidden' },
  queueBar: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 10 },
  queueText: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  queueAction: { fontSize: 13, fontWeight: '700', color: colors.accent },
  lyricsCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  lyrics: { fontSize: 16, lineHeight: 26, color: colors.textPrimary },
  openSongId: { fontSize: 12, color: colors.textTertiary, marginBottom: 8 },
  statsRow: { marginBottom: 8 },
  statsLabel: { fontSize: 14, color: colors.textSecondary },
  reactionsRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 24 },
  reactionItem: { flexDirection: 'row', alignItems: 'center', marginRight: 16, marginBottom: 6, borderRadius: 14, paddingHorizontal: 8, paddingVertical: 4 },
  reactionItemActive: { backgroundColor: colors.accent + '22' },
  reactionEmoji: { fontSize: 16, marginRight: 4 },
  reactionCount: { fontSize: 14, color: colors.textSecondary },
  commentsHeader: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginBottom: 8 },
  comment: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border },
  commentAuthor: { fontWeight: '600', fontSize: 14, color: colors.textPrimary },
  commentText: { fontSize: 14, color: colors.textSecondary, marginTop: 2 },
  empty: { color: colors.textSecondary },
  errorText: { color: colors.error },
  commentComposer: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 12 },
  commentInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    backgroundColor: colors.card,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: 14,
  },
  postButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
