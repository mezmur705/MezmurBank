import type { SongWithSinger } from '../types/models';

export function filterSongs(songs: SongWithSinger[], query: string): SongWithSinger[] {
  const q = query.trim().toLowerCase();
  if (!q) return songs;
  return songs.filter(
    song =>
      song.title.toLowerCase().includes(q) ||
      song.lyrics?.toLowerCase().includes(q) ||
      song.singers?.name?.toLowerCase().includes(q) ||
      song.singers?.amharic_name?.toLowerCase().includes(q) ||
      (song.open_song_id != null && String(song.open_song_id).includes(q))
  );
}
