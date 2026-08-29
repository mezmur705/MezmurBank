import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, StyleSheet, useWindowDimensions, Share, TouchableOpacity, TextInput, Alert, Linking } from 'react-native';
import YoutubePlayer from 'react-native-youtube-iframe';
import { MaterialIcons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
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
} from '../lib/api';
import { generateLyricsPptx } from '../lib/pptx';
import HighlightText from '../components/HighlightText';
import { colors } from '../theme';
import type { Comment } from '../types/models';

type Props = NativeStackScreenProps<RootStackParamList, 'SongDetail'>;

const REACTIONS: { key: 'like_count' | 'love_count' | 'haha_count' | 'wow_count' | 'sad_count' | 'angry_count'; emoji: string; label: string }[] = [
  { key: 'like_count', emoji: '👍', label: 'Like' },
  { key: 'love_count', emoji: '❤️', label: 'Love' },
  { key: 'haha_count', emoji: '😂', label: 'Haha' },
  { key: 'wow_count', emoji: '😮', label: 'Wow' },
  { key: 'sad_count', emoji: '😢', label: 'Sad' },
  { key: 'angry_count', emoji: '😠', label: 'Angry' },
];

export default function SongDetail({ route }: Props) {
  const { songId, query = '' } = route.params;
  const { songs } = useLibrary();
  const { user, session, promptSignIn } = useAuth();
  const { width } = useWindowDimensions();

  const song = useMemo(() => songs.find(s => s.id === songId), [songs, songId]);

  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [generatingSlides, setGeneratingSlides] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
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
      const { webViewLink } = await exportToDrive(songId, session.access_token);
      Alert.alert('Exported', 'The OpenSong-format file was saved to Drive.', [
        { text: 'Open', onPress: () => Linking.openURL(webViewLink) },
        { text: 'OK' },
      ]);
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

  const handleSharePptx = async () => {
    setGeneratingSlides(true);
    try {
      const uri = await generateLyricsPptx(song);
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert('Sharing not available', 'Sharing files is not supported on this device.');
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        dialogTitle: song.title,
      });
    } catch (err) {
      Alert.alert('Could not create PowerPoint', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setGeneratingSlides(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <HighlightText text={song.title} query={query} style={styles.title} numberOfLines={1} ellipsizeMode="tail" />
      <Text style={styles.singer}>
        {song.singers?.name}
        {song.singers?.amharic_name ? `  •  ${song.singers.amharic_name}` : ''}
      </Text>

      {song.youtube_video_id ? (
        <View style={styles.playerWrap}>
          <YoutubePlayer height={(width - 32) * 0.5625} videoId={song.youtube_video_id} />
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
        <TouchableOpacity
          onPress={handleSharePptx}
          style={styles.shareButton}
          accessibilityLabel="Share as PowerPoint"
          disabled={generatingSlides}
        >
          {generatingSlides ? (
            <ActivityIndicator size="small" color={colors.textPrimary} />
          ) : (
            <MaterialIcons name="slideshow" size={20} color={colors.textPrimary} />
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
          <View key={r.key} style={styles.reactionItem}>
            <Text style={styles.reactionEmoji}>{r.emoji}</Text>
            <Text style={styles.reactionCount}>{song[r.key]}</Text>
          </View>
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
  title: { fontSize: 24, fontWeight: '800', color: colors.textPrimary },
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
  playerWrap: { marginBottom: 16, borderRadius: 8, overflow: 'hidden' },
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
  reactionItem: { flexDirection: 'row', alignItems: 'center', marginRight: 16, marginBottom: 6 },
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
