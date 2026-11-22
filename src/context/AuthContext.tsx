import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  authError: string | null;
  signIn: () => Promise<void>;
  logout: () => Promise<void>;
  authFetch: (input: string, init?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (nextUser) {
        try {
          tokenRef.current = await nextUser.getIdToken();
        } catch (err) {
          console.error('Failed to retrieve ID token:', err);
          tokenRef.current = null;
        }
      } else {
        tokenRef.current = null;
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const signIn = useCallback(async () => {
    setAuthError(null);
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      tokenRef.current = await cred.user.getIdToken();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sign-in was cancelled or failed.';
      setAuthError(msg);
    }
  }, []);

  const logout = useCallback(async () => {
    tokenRef.current = null;
    await signOut(auth);
  }, []);

  const authFetch = useCallback(async (input: string, init?: RequestInit) => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('Please sign in with Google to access live café services.');
    }
    const freshToken = await currentUser.getIdToken();
    tokenRef.current = freshToken;

    const headers = new Headers(init?.headers || {});
    headers.set('Authorization', `Bearer ${freshToken}`);
    if (init?.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    return fetch(input, { ...init, headers });
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, authError, signIn, logout, authFetch }}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
