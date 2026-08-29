export interface Singer {
  id: number;
  name: string;
  amharic_name: string | null;
}

export interface Song {
  id: string;
  singer_id: number;
  title: string;
  lyrics: string;
  language: string;
  open_song_id: number | null;
  youtube_video_id: string | null;
  media_url: string | null;
  open_song_format: string | null;
  view_count: number;
  like_count: number;
  love_count: number;
  haha_count: number;
  wow_count: number;
  sad_count: number;
  angry_count: number;
}

export interface SongWithSinger extends Song {
  singers: Singer;
}

export interface Comment {
  id: number;
  song_id: string;
  author: string;
  comment: string;
  created_at: string;
}
