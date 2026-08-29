import { supabase } from './supabase';
import type { Singer, SongWithSinger, Comment } from '../types/models';

export async function getSingers(): Promise<Singer[]> {
  const { data, error } = await supabase.from('singers').select('*').order('name');
  if (error) throw error;
  return data ?? [];
}

const PAGE_SIZE = 1000;

// PostgREST caps unpaginated results (commonly at 1000 rows), which is below the
// current song count (~3219), so a single .select() silently truncates. Page through
// with .range() until a page comes back short, then return the full combined list.
export async function getSongs(): Promise<SongWithSinger[]> {
  const all: SongWithSinger[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('songs')
      .select('*, singers(*)')
      .order('title')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data as unknown as SongWithSinger[]) ?? [];
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

export async function getComments(songId: string): Promise<Comment[]> {
  const { data, error } = await supabase
    .from('song_comments')
    .select('*')
    .eq('song_id', songId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function postComment(songId: string, userId: string, author: string, comment: string): Promise<void> {
  const { error } = await supabase.from('song_comments').insert({ song_id: songId, user_id: userId, author, comment });
  if (error) throw error;
}

export async function getFavoriteSongIds(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from('favorites').select('song_id').eq('user_id', userId);
  if (error) throw error;
  return new Set((data ?? []).map(row => row.song_id as string));
}

export async function isFavorited(userId: string, songId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('favorites')
    .select('song_id')
    .eq('user_id', userId)
    .eq('song_id', songId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function addFavorite(userId: string, songId: string): Promise<void> {
  const { error } = await supabase.from('favorites').insert({ user_id: userId, song_id: songId });
  if (error) throw error;
}

export async function removeFavorite(userId: string, songId: string): Promise<void> {
  const { error } = await supabase.from('favorites').delete().eq('user_id', userId).eq('song_id', songId);
  if (error) throw error;
}

export async function recordRecentlyViewed(userId: string, songId: string): Promise<void> {
  const { error } = await supabase
    .from('recently_viewed')
    .upsert({ user_id: userId, song_id: songId, viewed_at: new Date().toISOString() });
  if (error) throw error;
}

export async function getRecentlyViewedSongIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('recently_viewed')
    .select('song_id')
    .eq('user_id', userId)
    .order('viewed_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  return (data ?? []).map(row => row.song_id as string);
}

export interface DriveExport {
  id: string;
  name: string;
  webViewLink: string;
  createdTime: string;
}

export async function getDriveExports(): Promise<DriveExport[]> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!apiUrl) throw new Error('Missing EXPO_PUBLIC_API_URL. Set it in mobile/.env.');
  const response = await fetch(`${apiUrl}/api/drive-exports`);
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error ?? 'Failed to load exported files.');
  return body;
}

export async function exportToDrive(
  songId: string,
  accessToken: string
): Promise<{ webViewLink: string; updated: boolean; sundayDate: string }> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!apiUrl) throw new Error('Missing EXPO_PUBLIC_API_URL. Set it in mobile/.env.');
  const response = await fetch(`${apiUrl}/api/mezmurs/${encodeURIComponent(songId)}/export-drive`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error ?? 'Export failed.');
  return body;
}
