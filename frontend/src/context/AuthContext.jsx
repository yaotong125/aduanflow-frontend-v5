import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../config';

const AuthContext = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('aduanflow_user');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  // Inactivity timeout state
  const [showTimeoutWarning, setShowTimeoutWarning] = useState(false);
  const [timeoutCountdown, setTimeoutCountdown] = useState(60);
  const inactivityTimer = useRef(null);
  const countdownTimer = useRef(null);
  const timeoutMinutes = useRef(30); // default, overridden by user setting

  const logout = useCallback(() => {
    // Revoke current session on backend
    const token = localStorage.getItem('aduanflow_session_token');
    if (token) {
      apiFetch(`/api/auth/sessions/${token}`, { method: 'DELETE' }).catch(() => {});
    }
    setUser(null);
    localStorage.removeItem('aduanflow_user');
    localStorage.removeItem('aduanflow_session_token');
    clearTimeout(inactivityTimer.current);
    clearInterval(countdownTimer.current);
    setShowTimeoutWarning(false);
  }, []);

  const resetInactivityTimer = useCallback(() => {
    clearTimeout(inactivityTimer.current);
    clearInterval(countdownTimer.current);
    setShowTimeoutWarning(false);

    const mins = timeoutMinutes.current;
    if (!mins || mins === 0) return; // "Never" option

    inactivityTimer.current = setTimeout(() => {
      // Show warning modal with 60s countdown
      setTimeoutCountdown(60);
      setShowTimeoutWarning(true);

      let count = 60;
      countdownTimer.current = setInterval(() => {
        count -= 1;
        setTimeoutCountdown(count);
        if (count <= 0) {
          clearInterval(countdownTimer.current);
          logout();
        }
      }, 1000);
    }, mins * 60 * 1000);
  }, [logout]);

  const stayLoggedIn = useCallback(() => {
    clearInterval(countdownTimer.current);
    setShowTimeoutWarning(false);
    resetInactivityTimer();
  }, [resetInactivityTimer]);

  // Attach activity listeners when user is logged in
  useEffect(() => {
    if (!user) {
      clearTimeout(inactivityTimer.current);
      clearInterval(countdownTimer.current);
      return;
    }

    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    const handler = () => resetInactivityTimer();
    events.forEach(e => window.addEventListener(e, handler, { passive: true }));
    resetInactivityTimer(); // start the timer immediately

    // Send session heartbeat every 30s
    const token = localStorage.getItem('aduanflow_session_token');
    const sendHeartbeat = () => {
      if (!token) return;
      apiFetch('/api/auth/sessions/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_token: token }),
      })
      .then(r => r.json().then(data => ({ status: r.status, data })))
      .then(({ status, data }) => {
        if (status === 401 || status === 403 || data.status === 'unauthorized') {
          logout(); // Instantly log out if session revoked or IP blocked
        }
      })
      .catch(() => {});
    };
    sendHeartbeat();
    const hbInterval = setInterval(sendHeartbeat, 30000);

    return () => {
      events.forEach(e => window.removeEventListener(e, handler));
      clearTimeout(inactivityTimer.current);
      clearInterval(countdownTimer.current);
      clearInterval(hbInterval);
    };
  }, [user, resetInactivityTimer]);

  // Load session timeout preference from backend when user logs in
  useEffect(() => {
    if (!user?.username) return;
    apiFetch(`/api/auth/settings/${user.username}`)
      .then(r => r.json())
      .then(data => {
        const mins = parseInt(data?.security?.session_timeout || '30', 10);
        timeoutMinutes.current = mins;
        resetInactivityTimer();
      })
      .catch(() => {});
  }, [user?.username, resetInactivityTimer]);

  const login = useCallback(async (username, password) => {
    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        let detail = 'Invalid credentials';
        try {
          const errData = await res.json();
          if (errData?.detail) detail = errData.detail;
        } catch {}
        return { success: false, error: detail };
      }
      const userData = await res.json();

      // If 2FA is required, return the userData so LoginPage can show the 2FA step
      if (userData.requires_2fa) {
        return { success: false, requires_2fa: true, userData };
      }

      // Store session token separately
      if (userData.session_token) {
        localStorage.setItem('aduanflow_session_token', userData.session_token);
      }

      // Check password expiry
      if (userData.password_expired) {
        setUser(userData);
        localStorage.setItem('aduanflow_user', JSON.stringify(userData));
        return { success: true, password_expired: true };
      }

      setUser(userData);
      localStorage.setItem('aduanflow_user', JSON.stringify(userData));
      return { success: true };
    } catch (e) {
      return { success: false, error: 'Unable to reach server. Please check your connection.' };
    }
  }, []);

  const completeLogin = useCallback((userData) => {
    // Called after 2FA verification succeeds
    if (userData.session_token) {
      localStorage.setItem('aduanflow_session_token', userData.session_token);
    }
    setUser(userData);
    localStorage.setItem('aduanflow_user', JSON.stringify(userData));
  }, []);

  const updateUser = useCallback((updates) => {
    setUser(prev => {
      if (!prev) return null;
      const nextUser = { ...prev, ...updates };
      localStorage.setItem('aduanflow_user', JSON.stringify(nextUser));
      return nextUser;
    });
  }, []);

  const isLoggedIn = !!user;

  return (
    <AuthContext.Provider value={{
      user,
      login,
      logout,
      isLoggedIn,
      completeLogin,
      updateUser,
      showTimeoutWarning,
      timeoutCountdown,
      stayLoggedIn,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
