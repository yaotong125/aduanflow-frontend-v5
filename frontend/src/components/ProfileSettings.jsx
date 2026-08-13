import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiFetch, BACKEND_URL } from '../config';
import { downloadSamplePdf } from '../data/samplePdfs';

const CHECKLIST = [
  { key: '2fa', label: 'Two-Factor Authentication', desc: 'Require a second verification step when logging in.' },
  { key: 'password_expiry', label: 'Password Expiry', desc: 'Force password change every 90 days.' },
  { key: 'ip_allowlist', label: 'IP Allowlisting', desc: 'Restrict access to approved network ranges.' },
];

const ROLE_GROUPS = {
  admin: ['Full access', 'Manage users', 'View all cases', 'Export audit logs', 'Configure pipeline settings'],
  investigator: ['View & assign cases', 'Update case statuses', 'Approve financial resolutions', 'Send communications'],
};

function useDebounce(fn, delay) {
  const timer = useRef(null);
  return useCallback((...args) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fn(...args), delay);
  }, [fn, delay]);
}

export default function ProfileSettings() {
  const { user, updateUser } = useAuth();
  const [tab, setTab] = useState('integrations');

  const [displayName, setDisplayName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [checklistState, setChecklistState] = useState(
    Object.fromEntries(CHECKLIST.map((c) => [c.key, false]))
  );
  const [notifs, setNotifs] = useState({
    case_assigned: true,
    status_changed: true,
    sla_breach: true,
    manual_review: false,
    weekly_digest: true,
  });
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [quietHours, setQuietHours] = useState(false);
  const [security, setSecurity] = useState({ new_device_alert: true, session_timeout: '30' });
  const [saved, setSaved] = useState(false);
  const [autoSaveMsg, setAutoSaveMsg] = useState('');

  // 2FA setup state
  const [twoFAModal, setTwoFAModal] = useState(null); // null | 'setup' | 'disable'
  const [twoFASecret, setTwoFASecret] = useState('');
  const [twoFAQR, setTwoFAQR] = useState('');
  const [twoFACode, setTwoFACode] = useState('');
  const [twoFALoading, setTwoFALoading] = useState(false);
  const [twoFAMsg, setTwoFAMsg] = useState('');

  // IP Allowlist state
  const [ipRanges, setIpRanges] = useState('');
  const [showIpModal, setShowIpModal] = useState(false);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdMsg, setPwdMsg] = useState('');

  // Active Sessions state
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  // Test notification state
  const [testNotifLoading, setTestNotifLoading] = useState(false);
  const [testNotifMsg, setTestNotifMsg] = useState('');

  // Weekly digest state
  const [digestLoading, setDigestLoading] = useState(false);
  const [digestMsg, setDigestMsg] = useState('');

  // Load settings on mount
  useEffect(() => {
    if (!user?.username) return;
    apiFetch(`/api/auth/settings/${user.username}`)
      .then(res => res.json())
      .then(data => {
        if (data.displayName) setDisplayName(data.displayName);
        if (data.email) setEmail(data.email);
        if (data.checklistState) setChecklistState(data.checklistState);
        if (data.notifs) setNotifs(data.notifs);
        if (data.emailEnabled !== undefined) setEmailEnabled(data.emailEnabled);
        if (data.quietHours !== undefined) setQuietHours(data.quietHours);
        if (data.security) setSecurity(data.security);
        if (data.ip_ranges) setIpRanges(data.ip_ranges);
      })
      .catch(err => console.error('Failed to fetch settings', err));
  }, [user]);

  // Load active sessions when on security tab
  const loadSessions = useCallback(() => {
    if (!user?.username) return;
    setSessionsLoading(true);
    apiFetch(`/api/auth/sessions/${user.username}`)
      .then(res => res.json())
      .then(data => { setSessions(Array.isArray(data) ? data : []); setSessionsLoading(false); })
      .catch(() => setSessionsLoading(false));
  }, [user?.username]);

  useEffect(() => {
    if (tab === 'security') loadSessions();
  }, [tab, loadSessions]);

  const handleSave = async () => {
    try {
      await apiFetch(`/api/auth/settings/${user.username}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName, email, checklistState, notifs, emailEnabled, quietHours, security, ip_ranges: ipRanges
        })
      });
      // Sync with global auth state so header/sidebar updates immediately
      if (updateUser) {
        updateUser({ name: displayName, email: email });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error(err);
    }
  };

  // Auto-save for alert toggles (debounced 800ms)
  const autoSave = useCallback(async (patch) => {
    try {
      await apiFetch(`/api/auth/settings/${user.username}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      setAutoSaveMsg('✓ Saved');
      setTimeout(() => setAutoSaveMsg(''), 1500);
    } catch {}
  }, [user?.username]);

  const debouncedAutoSave = useDebounce(autoSave, 800);

  const toggleNotif = (key, val) => {
    const next = { ...notifs, [key]: val };
    setNotifs(next);
    debouncedAutoSave({ notifs: next, emailEnabled, quietHours });
  };

  const toggleEmail = (val) => {
    setEmailEnabled(val);
    debouncedAutoSave({ notifs, emailEnabled: val, quietHours });
  };

  const toggleQuietHours = (val) => {
    setQuietHours(val);
    debouncedAutoSave({ notifs, emailEnabled, quietHours: val });
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) { setPwdMsg('New passwords do not match.'); return; }
    try {
      const res = await apiFetch(`/api/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username, current_password: currentPassword, new_password: newPassword })
      });
      const data = await res.json();
      if (!res.ok) { setPwdMsg(`Error: ${data.detail || 'Failed'}`); }
      else { setPwdMsg('✓ Password updated successfully!'); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); }
    } catch (err) { setPwdMsg(`Error: ${err.message}`); }
  };

  const handleRevokeSession = async (token) => {
    await apiFetch(`/api/auth/sessions/${token}`, { method: 'DELETE' });
    loadSessions();
  };

  const handleTestNotification = async () => {
    setTestNotifLoading(true);
    setTestNotifMsg('');
    try {
      const res = await apiFetch(`/api/auth/test-notification/${user.username}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Test notification failed.');
      setTestNotifMsg(data.smtp_delivered
        ? `✓ Test email delivered to ${data.recipient}!`
        : `✓ Test notification queued (${data.status}) — check Gmail connection if not received.`
      );
    } catch (err) { setTestNotifMsg(`Error: ${err.message}`); }
    setTestNotifLoading(false);
  };

  const handleSendDigest = async () => {
    setDigestLoading(true);
    setDigestMsg('');
    try {
      const res = await apiFetch(`/api/auth/send-weekly-digest/${user.username}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to send weekly digest.');
      setDigestMsg(data.message || '✓ Weekly digest sent!');
    } catch (err) { setDigestMsg(`Error: ${err.message}`); }
    setDigestLoading(false);
  };

  // ── 2FA Setup Flow ────────────────────────────────────────────────────────
  const handle2FAToggle = async (enabled) => {
    if (enabled) {
      // Open setup modal — fetch QR code
      setTwoFALoading(true);
      setTwoFAMsg('');
      try {
        const res = await apiFetch(`/api/auth/2fa/setup/${user.username}`, { method: 'POST' });
        const data = await res.json();
        setTwoFASecret(data.secret);
        setTwoFAQR(data.qr_code_base64);
        setTwoFACode('');
        setTwoFAModal('setup');
      } catch { setTwoFAMsg('Error generating QR code.'); }
      setTwoFALoading(false);
    } else {
      // Open disable modal
      setTwoFACode('');
      setTwoFAMsg('');
      setTwoFAModal('disable');
    }
  };

  const handleConfirm2FA = async () => {
    setTwoFALoading(true);
    setTwoFAMsg('');
    try {
      const res = await apiFetch(`/api/auth/2fa/confirm/${user.username}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: twoFASecret, code: twoFACode.trim() })
      });
      const data = await res.json();
      if (!res.ok) { setTwoFAMsg(data.detail || 'Invalid code.'); }
      else {
        setChecklistState(p => ({ ...p, '2fa': true }));
        setTwoFAModal(null);
        setTwoFAMsg('');
      }
    } catch { setTwoFAMsg('Network error.'); }
    setTwoFALoading(false);
  };

  const handleDisable2FA = async () => {
    setTwoFALoading(true);
    setTwoFAMsg('');
    try {
      const res = await apiFetch(`/api/auth/2fa/disable/${user.username}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: twoFACode.trim() })
      });
      const data = await res.json();
      if (!res.ok) { setTwoFAMsg(data.detail || 'Invalid code.'); }
      else {
        setChecklistState(p => ({ ...p, '2fa': false }));
        setTwoFAModal(null);
        setTwoFAMsg('');
      }
    } catch { setTwoFAMsg('Network error.'); }
    setTwoFALoading(false);
  };

  const currentSessionToken = typeof window !== 'undefined'
    ? localStorage.getItem('aduanflow_session_token')
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Settings</h2>
          <p className="text-sm text-slate-500 mt-0.5">Manage your account, preferences and security</p>
        </div>
        <button onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors shadow-sm">
          {saved ? '✓ Saved' : 'Save changes'}
        </button>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
        <div className="border-b border-slate-100 flex">
          {[
            { id: 'profile', label: 'Profile' },
            { id: 'integrations', label: 'Gmail & Integrations' },
            { id: 'alerts', label: 'Alert Preferences' },
            { id: 'security', label: 'Security' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-5 py-3.5 text-xs font-semibold transition-colors border-b-2 -mb-px ${
                tab === t.id ? 'text-blue-600 border-blue-500' : 'text-slate-500 border-transparent hover:text-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-6">

          {/* ─── Profile Tab ─── */}
          {tab === 'profile' && (
            <div className="space-y-6 max-w-lg">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-600 flex items-center justify-center text-white text-2xl font-bold ring-4 ring-blue-100 shadow-md">
                  {(user?.name || 'U')[0].toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">{user?.name}</p>
                  <p className="text-xs text-slate-500 capitalize">{user?.role} role</p>
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-semibold mt-1">✓ Taskforce Lead Badge Active</span>
                </div>
              </div>
              <hr />
              <div>
                <label htmlFor="display-name" className="block text-sm font-medium text-slate-700 mb-1.5">Display Name</label>
                <input id="display-name" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors bg-white" />
              </div>
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
                <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors bg-white" />
                <p className="text-[11px] text-slate-400 mt-1">This email is used for login and receiving case notifications.</p>
              </div>
              <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl">
                <p className="text-xs font-semibold text-blue-700 mb-2">Role Permissions — {user?.role}</p>
                <div className="space-y-1">
                  {ROLE_GROUPS[user?.role]?.map((p) => (
                    <label key={p} className="flex items-center gap-2 text-xs text-blue-700">
                      <svg className="w-3.5 h-3.5 text-blue-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      {p}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ─── Alert Preferences Tab ─── */}
          {tab === 'alerts' && (
            <div className="space-y-5 max-w-lg">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-slate-500">Choose which alerts and digests you receive.</p>
                {autoSaveMsg && (
                  <span className="text-xs font-semibold text-emerald-600 animate-pulse">{autoSaveMsg}</span>
                )}
              </div>

              {/* Email channel toggle */}
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium text-slate-700">Email Notifications</p>
                  <p className="text-xs text-slate-400">Receive case updates via email.</p>
                </div>
                <ToggleSwitch checked={emailEnabled} onChange={toggleEmail} />
              </div>

              <hr className="border-slate-100" />

              {/* Per-type toggles */}
              {Object.entries(notifs).map(([key, val]) => (
                <div key={key} className="flex items-center justify-between py-1">
                  <div>
                    <p className="text-sm font-medium text-slate-700 capitalize">{getNotificationLabel(key)}</p>
                    <p className="text-xs text-slate-400">{getNotificationDesc(key)}</p>
                  </div>
                  <ToggleSwitch checked={val} onChange={(v) => toggleNotif(key, v)} />
                </div>
              ))}

              <hr className="border-slate-100" />

              {/* Quiet hours */}
              <div className="flex items-center justify-between py-1">
                <div>
                  <p className="text-sm font-medium text-slate-700">Quiet Hours</p>
                  <p className="text-xs text-slate-400">No notifications between 10 PM – 7 AM.</p>
                </div>
                <ToggleSwitch checked={quietHours} onChange={toggleQuietHours} />
              </div>

              <hr className="border-slate-100" />

              {/* Test notification + Send digest */}
              <div className="space-y-3 pt-1">
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={handleTestNotification}
                    disabled={testNotifLoading || !emailEnabled}
                    className="px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-xl hover:bg-slate-800 disabled:opacity-50 transition-colors"
                  >
                    {testNotifLoading ? '↻ Sending…' : '📧 Send Test Notification'}
                  </button>
                  <button
                    onClick={handleSendDigest}
                    disabled={digestLoading}
                    className="px-4 py-2 text-xs font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {digestLoading ? '↻ Sending…' : '📊 Send Weekly Digest Now'}
                  </button>
                </div>
                {testNotifMsg && (
                  <p className={`text-xs font-medium ${testNotifMsg.startsWith('✓') ? 'text-emerald-600' : 'text-red-600'}`}>{testNotifMsg}</p>
                )}
                {digestMsg && (
                  <p className={`text-xs font-medium ${digestMsg.includes('sent') ? 'text-emerald-600' : 'text-amber-600'}`}>{digestMsg}</p>
                )}
                <p className="text-[11px] text-slate-400">
                  📅 Automatic weekly digest emails are sent every <strong>Monday at 8:00 AM MYT</strong> to users with Weekly Digest enabled.
                </p>
              </div>
            </div>
          )}

          {/* ─── Security Tab ─── */}
          {tab === 'security' && (
            <div className="space-y-6 max-w-lg">
              {/* Password */}
              <div>
                <p className="text-sm font-medium text-slate-700 mb-3">Change Password</p>
                <div className="space-y-3">
                  <div>
                    <label htmlFor="pwd-current" className="block text-xs font-medium text-slate-500 mb-1">Current Password</label>
                    <input id="pwd-current" type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} placeholder="••••••••"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors bg-white" />
                  </div>
                  <div>
                    <label htmlFor="pwd-new" className="block text-xs font-medium text-slate-500 mb-1">New Password</label>
                    <input id="pwd-new" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="••••••••"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors bg-white" />
                  </div>
                  <div>
                    <label htmlFor="pwd-confirm" className="block text-xs font-medium text-slate-500 mb-1">Confirm New Password</label>
                    <input id="pwd-confirm" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="••••••••"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors bg-white" />
                  </div>
                  {pwdMsg && (
                    <p className={`text-xs font-semibold ${pwdMsg.startsWith('✓') ? 'text-emerald-600' : 'text-red-600'}`}>{pwdMsg}</p>
                  )}
                  <button onClick={handleChangePassword} className="text-xs text-blue-600 hover:text-blue-700 font-semibold">Update password</button>
                </div>
              </div>

              <hr />

              {/* Session Timeout */}
              <div className="flex items-center justify-between py-1">
                <div>
                  <p className="text-sm font-medium text-slate-700">Session Timeout</p>
                  <p className="text-xs text-slate-400">Auto-logout after inactivity.</p>
                </div>
                <select
                  value={security.session_timeout}
                  onChange={(e) => {
                    const next = { ...security, session_timeout: e.target.value };
                    setSecurity(next);
                    autoSave({ security: next });
                  }}
                  className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                >
                  <option value="15">15 minutes</option>
                  <option value="30">30 minutes</option>
                  <option value="60">1 hour</option>
                  <option value="0">Never</option>
                </select>
              </div>

              <hr />

              {/* Active Sessions */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-medium text-slate-700">Active Sessions</p>
                  <button onClick={loadSessions} className="text-xs text-blue-600 hover:text-blue-700 font-semibold">
                    {sessionsLoading ? '↻ Refreshing…' : '↻ Refresh'}
                  </button>
                </div>
                <div className="space-y-3">
                  {sessions.length === 0 && !sessionsLoading && (
                    <p className="text-xs text-slate-400 text-center py-4">No active sessions found.</p>
                  )}
                  {sessions.map((s) => {
                    const isCurrent = s.session_token === currentSessionToken;
                    return (
                      <div key={s.session_token} className={`flex items-center justify-between p-3 border rounded-xl transition-colors ${isCurrent ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-100'}`}>
                        <div className="flex items-center gap-3">
                          <div className={`w-2.5 h-2.5 rounded-full ${isCurrent ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`} />
                          <div>
                            <p className="text-sm font-medium text-slate-700">{s.device_label}</p>
                            <p className="text-xs text-slate-400">
                              {s.ip_address ? (s.ip_address.includes(':') ? `${s.ip_address}/128` : `${s.ip_address}/32`) : s.ip_address}
                              {isCurrent ? ' · Current session' : ` · Last seen ${formatRelativeTime(s.last_seen_at)}`}
                            </p>
                          </div>
                        </div>
                        {!isCurrent && (
                          <button
                            onClick={() => handleRevokeSession(s.session_token)}
                            className="text-xs text-red-600 hover:text-red-700 font-semibold"
                          >
                            Revoke
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <hr />

              {/* Security Checklist */}
              <div>
                <p className="text-sm font-medium text-slate-700 mb-3">Security Checklist</p>
                <div className="space-y-3">
                  {CHECKLIST.map((c) => {
                    const isChecked = checklistState[c.key];
                    return (
                      <label
                        key={c.key}
                        className="flex items-start gap-3 p-3 bg-slate-50 border border-slate-100 rounded-xl cursor-pointer hover:border-blue-200 transition-colors"
                        onClick={(e) => {
                          e.preventDefault();
                          if (c.key === '2fa') {
                            handle2FAToggle(!isChecked);
                          } else if (c.key === 'ip_allowlist' && !isChecked) {
                            setShowIpModal(true);
                          } else {
                            const next = { ...checklistState, [c.key]: !isChecked };
                            setChecklistState(next);
                            autoSave({ checklistState: next });
                          }
                        }}
                      >
                        <div className={`mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${isChecked ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white'}`}>
                          {isChecked && (
                            <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-700 flex items-center gap-2">
                            {c.label}
                            {c.key === '2fa' && isChecked && (
                              <span className="text-[10px] bg-emerald-100 text-emerald-700 font-bold px-1.5 py-0.5 rounded-full">ACTIVE</span>
                            )}
                            {twoFALoading && c.key === '2fa' && (
                              <span className="text-[10px] text-slate-400">Setting up…</span>
                            )}
                          </p>
                          <p className="text-xs text-slate-400">{c.desc}</p>
                          {c.key === 'ip_allowlist' && isChecked && ipRanges && (
                            <p className="text-[11px] text-blue-600 mt-1 font-mono">{ipRanges}</p>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ─── Integrations Tab ─── */}
          {tab === 'integrations' && <GmailIntegrationSection />}
        </div>
      </div>

      {/* ── 2FA Setup Modal ──────────────────────────────────────────────── */}
      {twoFAModal === 'setup' && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="text-center">
              <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                </svg>
              </div>
              <h3 className="text-base font-bold text-slate-900">Set Up Two-Factor Authentication</h3>
              <p className="text-xs text-slate-500 mt-1">Scan this QR code with Google Authenticator, Authy, or Microsoft Authenticator.</p>
            </div>

            {twoFAQR && (
              <div className="flex justify-center">
                <div className="p-3 bg-white border-2 border-slate-200 rounded-xl inline-block">
                  <img src={`data:image/png;base64,${twoFAQR}`} alt="2FA QR Code" className="w-44 h-44" />
                </div>
              </div>
            )}

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
              <p className="text-[11px] text-slate-500 mb-1">Or enter this code manually in your app:</p>
              <p className="text-xs font-mono font-bold text-slate-800 tracking-widest break-all">{twoFASecret}</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Enter the 6-digit code from your app to confirm</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                autoFocus
                placeholder="000000"
                value={twoFACode}
                onChange={(e) => setTwoFACode(e.target.value.replace(/\D/g, ''))}
                className="w-full px-4 py-3 text-center text-xl font-mono tracking-[0.5em] border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
              />
            </div>

            {twoFAMsg && (
              <p className="text-xs text-red-600 font-medium">{twoFAMsg}</p>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleConfirm2FA}
                disabled={twoFALoading || twoFACode.length !== 6}
                className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {twoFALoading ? '↻ Verifying…' : 'Confirm & Enable 2FA'}
              </button>
              <button
                onClick={() => { setTwoFAModal(null); setTwoFAMsg(''); }}
                className="px-4 py-2.5 bg-slate-100 text-slate-700 text-sm font-semibold rounded-xl hover:bg-slate-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 2FA Disable Modal ─────────────────────────────────────────────── */}
      {twoFAModal === 'disable' && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900">Disable Two-Factor Authentication</h3>
            <p className="text-sm text-slate-500">Enter your current authenticator code to confirm you want to disable 2FA.</p>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              autoFocus
              placeholder="000000"
              value={twoFACode}
              onChange={(e) => setTwoFACode(e.target.value.replace(/\D/g, ''))}
              className="w-full px-4 py-3 text-center text-xl font-mono tracking-[0.5em] border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400 bg-white"
            />
            {twoFAMsg && <p className="text-xs text-red-600 font-medium">{twoFAMsg}</p>}
            <div className="flex gap-3">
              <button
                onClick={handleDisable2FA}
                disabled={twoFALoading || twoFACode.length !== 6}
                className="flex-1 py-2.5 bg-red-600 text-white text-sm font-semibold rounded-xl hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {twoFALoading ? '↻ Disabling…' : 'Disable 2FA'}
              </button>
              <button
                onClick={() => { setTwoFAModal(null); setTwoFAMsg(''); }}
                className="px-4 py-2.5 bg-slate-100 text-slate-700 text-sm font-semibold rounded-xl hover:bg-slate-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── IP Allowlist Modal ─────────────────────────────────────────────── */}
      {showIpModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900">IP Allowlisting</h3>
            <p className="text-sm text-slate-500">Enter comma-separated IP ranges (CIDR notation) that are allowed to access AduanFlow.</p>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Allowed IP Ranges</label>
              <textarea
                rows={3}
                placeholder="e.g. 192.168.1.0/24, 10.0.0.0/8"
                value={ipRanges}
                onChange={(e) => setIpRanges(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm font-mono border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
              />
            </div>
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
              <p className="text-xs text-amber-800 font-medium">⚠️ Network-level IP enforcement requires additional firewall configuration by your system administrator. This setting is saved as a reference configuration.</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  const next = { ...checklistState, ip_allowlist: true };
                  setChecklistState(next);
                  autoSave({ checklistState: next, ip_ranges: ipRanges });
                  setShowIpModal(false);
                }}
                className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors"
              >
                Save & Enable
              </button>
              <button
                onClick={() => setShowIpModal(false)}
                className="px-4 py-2.5 bg-slate-100 text-slate-700 text-sm font-semibold rounded-xl hover:bg-slate-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Helpers ─── */

function formatRelativeTime(isoString) {
  if (!isoString) return '';
  try {
    const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  } catch { return ''; }
}

function ToggleSwitch({ checked, onChange }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-slate-200'}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

function getNotificationLabel(key) {
  const map = {
    case_assigned: 'Case Assigned',
    status_changed: 'Status Changed',
    sla_breach: 'SLA Breach',
    manual_review: 'Manual Review',
    weekly_digest: 'Weekly Digest',
  };
  return map[key] || key.replace(/_/g, ' ');
}

function getNotificationDesc(key) {
  const map = {
    case_assigned: 'Get notified when a new case is assigned to you.',
    status_changed: 'Alert when any case status changes.',
    sla_breach: 'Warning when a case is close to breaching its SLA.',
    manual_review: 'Notify for cases queued in manual review.',
    weekly_digest: 'Weekly summary of all activity.',
  };
  return map[key] || '';
}

/* ─── Gmail Integration Section (unchanged) ─── */

function GmailIntegrationSection() {
  const [status, setStatus] = React.useState({ is_connected: false, email: '' });
  const [email, setEmail] = React.useState('');
  const [refreshToken, setRefreshToken] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [msg, setMsg] = React.useState('');
  const [syncing, setSyncing] = useState(false);

  const [activeTeammates, setActiveTeammates] = React.useState({
    active_teammates_count: 1,
    other_active_users: [],
    is_another_user_active: false,
  });

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('oauth_cancelled') === 'true') setMsg('⚠️ Google OAuth authorization was cancelled.');
    else if (params.get('oauth_success') === 'true') setMsg('🎉 Google OAuth 2.0 Mailbox connected & encrypted successfully!');
    else if (params.get('oauth_error')) setMsg(`Error: ${params.get('oauth_error')}`);

    apiFetch('/api/auth/gmail-status').then(r => r.json()).then(d => { setStatus(d); if (d?.email) setEmail(d.email); }).catch(() => {});

    let cid = sessionStorage.getItem('aduanflow_client_id');
    if (!cid) { cid = 'client_' + Math.random().toString(36).substring(2, 9); sessionStorage.setItem('aduanflow_client_id', cid); }
    const hb = () => apiFetch('/api/auth/heartbeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: cid }) })
      .then(r => r.json()).then(d => { if (d && typeof d.active_teammates_count === 'number') setActiveTeammates(d); }).catch(() => {});
    hb();
    const iv = setInterval(hb, 5000);
    return () => clearInterval(iv);
  }, []);

  const handleConnect = (e) => {
    e.preventDefault();
    if (!email || !refreshToken) { setMsg('Please fill in both fields.'); return; }
    setLoading(true); setMsg('');
    apiFetch('/api/auth/gmail-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, refresh_token: refreshToken }) })
      .then(r => { if (!r.ok) throw new Error('Failed'); return r.json(); })
      .then(d => { setStatus(d); setMsg('✓ Gmail Mailbox connected!'); setRefreshToken(''); setLoading(false); })
      .catch(err => { setMsg(`Error: ${err.message}`); setLoading(false); });
  };

  const handleSyncInbox = () => {
    setSyncing(true); setMsg('');
    apiFetch('/api/auth/gmail-sync', { method: 'POST' }).then(r => r.json()).then(d => {
      setSyncing(false);
      const count = (d.synced_cases || d.cases || []).length;
      setMsg(d.status === 'success' ? `✓ Synced ${count} dispute email(s). Case IDs: ${(d.synced_cases || []).join(', ')}.` : `✓ ${d.message || 'Inbox synchronized.'}`);
    }).catch(err => { setSyncing(false); setMsg(`Error: ${err.message}`); });
  };

  const handleDisconnect = () => {
    if (!window.confirm('Disconnect the complaints mailbox?')) return;
    apiFetch('/api/auth/gmail-token', { method: 'DELETE' }).then(() => { setStatus({ is_connected: false }); setMsg('Disconnected.'); }).catch(() => {});
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center text-red-600 font-bold">M</div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Gmail Complaints Mailbox (OAuth 2.0)</h3>
            <p className="text-xs text-slate-500">Automated Email Intake Engine Integration</p>
          </div>
        </div>
        {status.is_connected ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Connected: {status.email}
            </span>
            <button onClick={handleSyncInbox} disabled={syncing} className="text-xs px-3.5 py-1.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors">
              {syncing ? '↻ Polling…' : '⚡ Sync Inbox Now'}
            </button>
            <button onClick={handleDisconnect} className="text-xs px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100">Disconnect</button>
          </div>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
            <span className="w-2 h-2 rounded-full bg-amber-500" />Not Connected
          </span>
        )}
      </div>

      <div className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-between transition-all ${activeTeammates.is_another_user_active ? 'bg-blue-50 border-blue-200 text-blue-900' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${activeTeammates.is_another_user_active ? 'bg-blue-400' : 'bg-emerald-400'}`} />
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${activeTeammates.is_another_user_active ? 'bg-blue-500' : 'bg-emerald-500'}`} />
          </span>
          <span>{activeTeammates.active_teammates_count > 1 ? `🟢 ${activeTeammates.active_teammates_count} Teammates Active (${activeTeammates.other_active_users.join(', ')})` : '🟢 You are the only active investigator online'}</span>
        </div>
      </div>

      {msg && (
        <div className={`p-3 rounded-xl text-xs font-medium ${msg.startsWith('✓') || msg.startsWith('🎉') ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{msg}</div>
      )}

      <form onSubmit={handleConnect} className="space-y-4 bg-white p-5 border border-slate-200 rounded-xl shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h4 className="text-sm font-bold text-slate-900">🌐 Enterprise Google OAuth 2.0 Integration</h4>
            <p className="text-xs text-slate-500 mt-0.5">One-click Google Authorization grants a Permanent Refresh Token stored encrypted with Fernet AES-256.</p>
          </div>
        </div>
        {status.is_connected && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs font-semibold text-amber-900 flex items-center gap-2">
            🔒 Mailbox locked to <strong>{status.email}</strong>. Click Disconnect to switch accounts.
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Complaints Email Address <span className="text-red-500">*</span></label>
          <input type="email" required disabled={status.is_connected} value={email} onChange={e => setEmail(e.target.value)} placeholder="e.g. complaints@bank.com"
            className={`w-full px-3.5 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 ${status.is_connected ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : ''}`} />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">OAuth 2.0 Refresh Token <span className="text-red-500">*</span></label>
          <input type="text" required disabled={status.is_connected} value={refreshToken} onChange={e => setRefreshToken(e.target.value)}
            placeholder={status.is_connected ? '•••••••••••••• (Encrypted & Active)' : 'Paste 1//0... refresh token'}
            className={`w-full px-3.5 py-2 text-xs border border-slate-200 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 ${status.is_connected ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : ''}`} />
        </div>
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={() => { if (!status.is_connected) window.location.href = `${BACKEND_URL}/api/auth/google/login`; }} disabled={loading || status.is_connected}
            className={`flex-1 py-2.5 bg-blue-600 text-white text-xs font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors ${status.is_connected ? 'cursor-not-allowed opacity-60' : ''}`}>
            {status.is_connected ? '🔒 Mailbox Active & Locked' : '🔑 Authorize & Connect (1-Click)'}
          </button>
          <button type="submit" disabled={loading || status.is_connected} className={`px-6 py-2.5 bg-slate-900 text-white text-xs font-semibold rounded-xl hover:bg-slate-800 disabled:opacity-50 transition-colors ${status.is_connected ? 'cursor-not-allowed opacity-60' : ''}`}>
            {status.is_connected ? 'Locked' : 'Save Token'}
          </button>
        </div>
      </form>
    </div>
  );
}
