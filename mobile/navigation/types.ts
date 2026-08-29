export type RootStackParamList = {
  SingersList: undefined;
  SongsList: { singerId: number; singerName: string; query?: string };
  SongDetail: { songId: string; query?: string };
  RecentlyViewed: undefined;
  Favorites: undefined;
  DriveExports: undefined;
};
