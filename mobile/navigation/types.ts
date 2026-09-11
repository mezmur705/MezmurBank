export type RootStackParamList = {
  SingersList: undefined;
  SongsList: { singerId: number; singerName: string; query?: string };
  // queue/queueIndex: present when opened via "Play All" - SongDetail auto-advances to
  // queue[queueIndex + 1] when the current song's video finishes.
  SongDetail: { songId: string; query?: string; queue?: string[]; queueIndex?: number };
  RecentlyViewed: undefined;
  Favorites: undefined;
  DriveExports: undefined;
  SundaySongs: undefined;
};
