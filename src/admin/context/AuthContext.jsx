// Admin auth boundary. The session lives in an HttpOnly cookie; this context
// only mirrors the current `user` object (from `GET /api/admin/me`) for the UI
// gate. `null` user → redirect to /admin/login. `undefined` → still bootstrapping.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getMe, logout, onSessionExpired } from "../api/client.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);

  const refresh = useCallback(async () => {
    try {
      const payload = await getMe();
      setUser(payload ? payload.user : null);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bootstrap: mirrors the session cookie into React state once the GET /api/admin/me promise resolves
    refresh();
  }, [refresh]);

  useEffect(() => {
    const unsubscribe = onSessionExpired(() => {
      setUser(null);
    });
    return unsubscribe;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logout();
    } catch {
      // The server clears the cookie even when it refuses the request;
      // dropping to the logged-out state is correct either way.
    }
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, refresh, signOut }),
    [user, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>.");
  return ctx;
}