import { useEffect, useState } from "react";
import { api } from "../api";
import { useMail } from "../state";
import type { BlockEntry } from "../types";

export function Settings() {
  const { settingsOpen, setSettingsOpen, boot, saveSettings, updateAccount, removeAccount, sessionAccounts } = useMail();
  const [blocks, setBlocks] = useState<BlockEntry[]>([]);
  const [googleId, setGoogleId] = useState("");
  const [googleSecret, setGoogleSecret] = useState("");
  const [microsoftId, setMicrosoftId] = useState("");
  const [microsoftSecret, setMicrosoftSecret] = useState("");

  useEffect(() => {
    if (!settingsOpen || !boot) return;
    setGoogleId(boot.oauth.google_client_id);
    setMicrosoftId(boot.oauth.microsoft_client_id);
    api<{ entries: BlockEntry[] }>(`/api/blocklist?session_id=${boot.active_session_id}`)
      .then((data) => setBlocks(data.entries))
      .catch(() => setBlocks([]));
  }, [settingsOpen, boot]);

  if (!settingsOpen || !boot) return null;

  return (
    <div className="overlay" onMouseDown={() => setSettingsOpen(false)}>
      <div className="sheet stack" role="dialog" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="list-title">
          <h2 id="settings-title">Settings</h2>
          <button className="text-btn" onClick={() => setSettingsOpen(false)}>
            Close
          </button>
        </div>
        <div className="grid-2">
          <label className="field">
            <span>Theme</span>
            <select
              value={boot.settings.theme}
              onChange={(event) => void saveSettings({ theme: event.target.value })}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label className="field">
            <span>Density</span>
            <select
              value={boot.settings.density}
              onChange={(event) => void saveSettings({ density: event.target.value })}
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </label>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={boot.settings.load_remote_images}
            onChange={(event) => void saveSettings({ load_remote_images: event.target.checked })}
          />
          Load remote images by default
        </label>
        <h3>Accounts in this session</h3>
        {sessionAccounts.map((account) => (
          <div key={account.id} className="row-actions">
            <span className="dot" style={{ background: account.color }} />
            <span>{account.email}</span>
            <select
              aria-label={`Session for ${account.email}`}
              value={account.session_id}
              onChange={(event) => void updateAccount(account.id, { session_id: Number(event.target.value) })}
            >
              {boot.sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.name}
                </option>
              ))}
            </select>
            <button className="text-btn" onClick={() => void removeAccount(account.id)}>
              Remove
            </button>
          </div>
        ))}
        {accountErrors(sessionAccounts)}
        <h3>Browser sign-in</h3>
        <p className="meta">
          Redirect URI for both providers: <code>{boot.oauth.redirect_uri}</code>
        </p>
        <label className="field">
          <span>Google client id</span>
          <input value={googleId} onChange={(event) => setGoogleId(event.target.value)} />
        </label>
        <label className="field">
          <span>Google client secret</span>
          <input
            type="password"
            placeholder={boot.oauth.google_has_secret ? "Saved" : ""}
            value={googleSecret}
            onChange={(event) => setGoogleSecret(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Microsoft client id</span>
          <input value={microsoftId} onChange={(event) => setMicrosoftId(event.target.value)} />
        </label>
        <label className="field">
          <span>Microsoft client secret</span>
          <input
            type="password"
            placeholder={boot.oauth.microsoft_has_secret ? "Saved" : ""}
            value={microsoftSecret}
            onChange={(event) => setMicrosoftSecret(event.target.value)}
          />
        </label>
        <button
          className="btn primary"
          onClick={() =>
            void saveSettings({
              google_client_id: googleId,
              google_client_secret: googleSecret,
              microsoft_client_id: microsoftId,
              microsoft_client_secret: microsoftSecret,
            })
          }
        >
          Save sign-in apps
        </button>
        <h3>Blocked senders</h3>
        {blocks.length === 0 ? <p className="meta">No blocked senders in this session.</p> : null}
        {blocks.map((entry) => (
          <div key={entry.id} className="row-actions">
            <span>{entry.value}</span>
            <button
              className="text-btn"
              onClick={() => {
                void api(`/api/blocklist/${entry.id}`, { method: "DELETE" }).then(() =>
                  setBlocks((current) => current.filter((item) => item.id !== entry.id)),
                );
              }}
            >
              Unblock
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function accountErrors(accounts: { email: string; last_error: string }[]) {
  const broken = accounts.filter((account) => account.last_error);
  if (!broken.length) return null;
  return (
    <div>
      {broken.map((account) => (
        <p key={account.email} className="error-line">
          {account.email}: {account.last_error}
        </p>
      ))}
    </div>
  );
}
