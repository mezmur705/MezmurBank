import { supabase } from './supabase';
import type { Singer, SongWithSinger, Comment } from '../types/models';

// 'main' is a catch-all bucket for songs whose real singer isn't identified - pushed to the
// end of the list (matching the web app) instead of sorting alphabetically with everyone else.
export async function getSingers(): Promise<Singer[]> {
  const { data, error } = await supabase.from('singers').select('*').order('name');
  if (error) throw error;
  const singers = data ?? [];
  const mainIndex = singers.findIndex(s => s.name === 'main');
  if (mainIndex === -1) return singers;
  const [main] = singers.splice(mainIndex, 1);
  return [...singers, main];
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

export interface SundaySong {
  songId: string;
  position: number;
  title: string;
  openSongId: number | null;
  singer: string;
}

// date: a Sunday within the next month; omitted (or out of range) = the nearest Sunday.
export async function getSundaySongs(date?: string): Promise<{ date: string; songs: SundaySong[] }> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!apiUrl) throw new Error('Missing EXPO_PUBLIC_API_URL. Set it in mobile/.env.');
  const query = date ? `?date=${encodeURIComponent(date)}` : '';
  const response = await fetch(`${apiUrl}/api/sunday-songs${query}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error ?? 'Failed to load Sunday songs.');
  return body;
}

export type ReactionType = 'like' | 'love' | 'haha' | 'wow' | 'sad' | 'angry';

// Anonymous, no sign-in required - matches the web app's reaction endpoint. Callers are
// responsible for their own "already reacted" guard (SongDetail tracks it in AsyncStorage).
// remove: true undoes a previously-saved reaction (tapping the same emoji again) instead
// of adding one - switching straight to a different reaction isn't supported, just undo.
export async function reactToSong(songId: string, type: ReactionType, remove = false): Promise<void> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!apiUrl) throw new Error('Missing EXPO_PUBLIC_API_URL. Set it in mobile/.env.');
  const response = await fetch(`${apiUrl}/api/mezmurs/${encodeURIComponent(songId)}/react`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, remove }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error ?? 'Failed to save reaction.');
  }
}

// Saves a song's YouTube video (accepts a pasted watch/embed/shorts/youtu.be link or a bare
// 11-char video ID - server-side parsing in extractYoutubeId). TEMPORARILY open to everyone,
// no sign-in required, matching the same change made to the web app's confirm endpoint.
export async function confirmYoutubeLink(songId: string, videoIdOrLink: string): Promise<{ videoId: string | null }> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!apiUrl) throw new Error('Missing EXPO_PUBLIC_API_URL. Set it in mobile/.env.');
  const response = await fetch(`${apiUrl}/api/mezmurs/${encodeURIComponent(songId)}/youtube/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoId: videoIdOrLink }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error ?? 'Could not save the YouTube link.');
  return body;
}

// Whether the signed-in user may export to the OpenSong Drive folder (admins, plus the
// server's EXPORT_EMAILS list). Any failure is treated as "no".
export async function getCanExport(accessToken: string): Promise<boolean> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!apiUrl) return false;
  try {
    const response = await fetch(`${apiUrl}/api/admin/status`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = await response.json();
    return !!body?.canExport;
  } catch {
    return false;
  }
}

// Saves a Sunday's song order (exporters and admins). songIds (new order) plus removeIds
// (taken off this Sunday) must be exactly that Sunday's current songs.
export async function saveSundayOrder(
  songIds: string[],
  date: string,
  accessToken: string,
  removeIds: string[] = []
): Promise<void> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!apiUrl) throw new Error('Missing EXPO_PUBLIC_API_URL. Set it in mobile/.env.');
  const response = await fetch(`${apiUrl}/api/sunday-songs/order`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ songIds, removeIds, date }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error ?? 'Could not save the order.');
  }
}

// sundayDate: which Sunday (within the next month) to add the song to; the server falls
// back to the nearest Sunday when it's missing or out of range.
export async function exportToDrive(
  songId: string,
  accessToken: string,
  sundayDate?: string
): Promise<{ webViewLink: string; updated: boolean; sundayDate: string }> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!apiUrl) throw new Error('Missing EXPO_PUBLIC_API_URL. Set it in mobile/.env.');
  const response = await fetch(`${apiUrl}/api/mezmurs/${encodeURIComponent(songId)}/export-drive`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: sundayDate }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error ?? 'Export failed.');
  return body;
}

// Someone on the choir member list: a Mezmurify user (email set) or just a typed name.
export interface ChoirMember {
  id: number;
  name: string;
  email: string | null;
  group: 'A' | 'B' | null;
}

// A person assigned to a role (older entries only carry an email).
export interface ChoirPerson {
  memberId?: number;
  email?: string;
  name: string;
}

// A Mezmurify sign-in user, for adding to the member list.
export interface ChoirUser {
  email: string;
  name: string;
}

export interface ChoirAssignments {
  leadSinger?: ChoirPerson[];
  keyboard?: ChoirPerson[];
  guitar?: ChoirPerson[];
  solo?: ChoirPerson[];
  singerGroup?: ('A' | 'B')[];
  preacher?: string | null; // Prediger, free text
  sermonTitle?: string | null; // title of the sermon
}

export interface ChoirRehearsal {
  id: number;
  date: string; // YYYY-MM-DD
  startTime: string | null; // HH:MM
  endTime: string | null;
  place: string | null;
  notes: string | null;
  assignments: ChoirAssignments;
  saturdayTraining: boolean | null; // null = not decided
  trainingReason: string | null;
  livestreamUrl: string | null; // YouTube livestream for that day
}

export type ChoirRehearsalInput = Omit<ChoirRehearsal, 'id'>;

// Upcoming rehearsals (signed-in users only); canEdit = admin or export rights.
export async function getChoirPlan(accessToken: string): Promise<{ canEdit: boolean; rehearsals: ChoirRehearsal[] }> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!apiUrl) throw new Error('Missing EXPO_PUBLIC_API_URL. Set it in mobile/.env.');
  const response = await fetch(`${apiUrl}/api/choir-plan`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error ?? 'Could not load the choir plan.');
  return body;
}

// The choir member list (signed-in users).
export async function getChoirMembers(accessToken: string): Promise<ChoirMember[]> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!apiUrl) throw new Error('Missing EXPO_PUBLIC_API_URL. Set it in mobile/.env.');
  const response = await fetch(`${apiUrl}/api/choir-plan/members`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = await response.json().catch(() => []);
  if (!response.ok) throw new Error(body?.error ?? 'Could not load the members.');
  return body;
}

// Mezmurify sign-in users to add as members (planners only).
export async function getChoirUsers(accessToken: string): Promise<ChoirUser[]> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!apiUrl) throw new Error('Missing EXPO_PUBLIC_API_URL. Set it in mobile/.env.');
  const response = await fetch(`${apiUrl}/api/choir-plan/users`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = await response.json().catch(() => []);
  if (!response.ok) throw new Error(body?.error ?? 'Could not load the users.');
  return body;
}

// Adds a member (no id), changes one (id), or removes one (remove: true). Planners only.
export async function saveChoirMember(
  accessToken: string,
  member: { id?: number; name?: string; email?: string | null; group?: 'A' | 'B' | null },
  remove = false
): Promise<void> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!apiUrl) throw new Error('Missing EXPO_PUBLIC_API_URL. Set it in mobile/.env.');
  const response = await fetch(`${apiUrl}/api/choir-plan/members${member.id ? `/${member.id}` : ''}`, {
    method: remove ? 'DELETE' : member.id ? 'PUT' : 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: remove ? undefined : JSON.stringify({ name: member.name, email: member.email ?? null, group: member.group ?? null }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error ?? 'Could not save the member.');
  }
}

// Creates a rehearsal, or updates it when id is given.
export async function saveChoirRehearsal(accessToken: string, input: ChoirRehearsalInput, id?: number): Promise<void> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!apiUrl) throw new Error('Missing EXPO_PUBLIC_API_URL. Set it in mobile/.env.');
  const response = await fetch(`${apiUrl}/api/choir-plan${id ? `/${id}` : ''}`, {
    method: id ? 'PUT' : 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error ?? 'Could not save the rehearsal.');
  }
}

export async function deleteChoirRehearsal(accessToken: string, id: number): Promise<void> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!apiUrl) throw new Error('Missing EXPO_PUBLIC_API_URL. Set it in mobile/.env.');
  const response = await fetch(`${apiUrl}/api/choir-plan/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error ?? 'Could not delete the rehearsal.');
  }
}
