import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getSingers, getSongs } from '../lib/api';
import type { Singer, SongWithSinger } from '../types/models';

interface LibraryState {
  singers: Singer[];
  songs: SongWithSinger[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const LibraryContext = createContext<LibraryState | undefined>(undefined);

export function LibraryProvider({ children }: { children: React.ReactNode }) {
  const [singers, setSingers] = useState<Singer[]>([]);
  const [songs, setSongs] = useState<SongWithSinger[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [singersData, songsData] = await Promise.all([getSingers(), getSongs()]);
      setSingers(singersData);
      setSongs(songsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <LibraryContext.Provider value={{ singers, songs, loading, error, refresh }}>
      {children}
    </LibraryContext.Provider>
  );
}

export function useLibrary(): LibraryState {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary must be used within a LibraryProvider');
  return ctx;
}
