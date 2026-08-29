import React, { createContext, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { GoogleSignin, isSuccessResponse } from '@react-native-google-signin/google-signin';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
});

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  signInSheetVisible: boolean;
  promptSignIn: () => void;
  dismissSignInSheet: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [signInSheetVisible, setSignInSheetVisible] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    if (Platform.OS === 'android') {
      await GoogleSignin.hasPlayServices();
    }
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return; // user cancelled
    const idToken = response.data.idToken;
    if (!idToken) throw new Error('Google sign-in did not return an ID token.');
    const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
    if (error) throw error;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    try {
      await GoogleSignin.signOut();
    } catch {
      // not signed in via Google, nothing to clear
    }
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        signInWithGoogle,
        signOut,
        signInSheetVisible,
        promptSignIn: () => setSignInSheetVisible(true),
        dismissSignInSheet: () => setSignInSheetVisible(false),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
