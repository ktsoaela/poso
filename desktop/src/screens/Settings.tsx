import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDownUp,
  Ban,
  Filter,
  History,
  Info,
  KeyRound,
  Layers,
  Palette,
  Plus,
  RefreshCw,
  Tag,
  Trash2,
  UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, post } from "../api";
import { relative } from "../format";
import { useMail, type SettingsTab } from "../state";
import type { Account, Accent, BlockEntry } from "../types";
import { Modal, Segmented, Toggle } from "../components/ui";
import { RichEditor, type EditorHandle } from "../components/RichEditor";
import { AccountForm } from "./AccountForm";
import { AuditTab } from "./settings/AuditTab";
import { DataTab } from "./settings/DataTab";
import { RulesTab } from "./settings/RulesTab";
import { requestNotificationPermission } from "../desktop";

const TABS: { id: SettingsTab; label: string; icon: LucideIcon }[] = [
  { id: "general", label: "General", icon: Palette },
  { id: "accounts", label: "Accounts", icon: UserRound },
  { id: "sessions", label: "Sessions", icon: Layers },
  { id: "labels", label: "Labels", icon: Tag },
  { id: "rules", label: "Rules & filters", icon: Filter },
  { id: "spam", label: "Spam & blocked", icon: Ban },
  { id: "signin", label: "Sign-in apps", icon: KeyRound },
  { id: "data", label: "Import & export", icon: ArrowDownUp },
  { id: "audit", label: "Audit log", icon: History },
  { id: "about", label: "About", icon: Info },
];

const ACCENTS: { id: Accent; color: string }[] = [
  { id: "indigo", color: "#4f46e5" },
  { id: "blue", color: "#2563eb" },
  { id: "teal", color: "#0d9488" },
  { id: "violet", color: "#7c3aed" },
  { id: "rose", color: "#e11d48" },
  { id: "amber", color: "#d97706" },
  { id: "slate", color: "#475569" },
];

export const SWATCHES = ["#4f46e5", "#2563eb", "#0ea5e9", "#0d9488", "#10b981", "#84cc16", "#f59e0b", "#f97316", "#ef4444", "#e11d48", "#ec4899", "#8b5cf6", "#64748b"];

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="set-section">
      <div className="set-section-head">
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="set-row">
      <div>
        <div className="set-label">{label}</div>
        {hint ? <div className="set-hint">{hint}</div> : null}
      </div>
      <div className="set-control">{children}</div>
    </div>
  );
}

function SwatchPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="swatches">
      {SWATCHES.map((color) => (
        <button key={color} type="button" className={`swatch-btn${value.toLowerCase() === color ? " on" : ""}`} style={{ background: color }} aria-label={color} onClick={() => onChange(color)} />
      ))}
    </div>
  );
}

function GeneralTab() {
  const { boot, saveSettings, toast } = useMail();
  if (!boot) return null;
  const s = boot.settings;
  return (
    <>
      <Section title="Appearance">
        <Row label="Theme">
          <Segmented value={s.theme} onChange={(theme) => void saveSettings({ theme })} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "System" }]} />
        </Row>
        <Row label="Accent color">
          <div className="swatches">
            {ACCENTS.map((item) => (
              <button key={item.id} type="button" className={`swatch-btn${s.accent === item.id ? " on" : ""}`} style={{ background: item.color }} aria-label={item.id} onClick={() => void saveSettings({ accent: item.id })} />
            ))}
          </div>
        </Row>
        <Row label="Density" hint="Compact fits more conversations on screen.">
          <Segmented value={s.density} onChange={(density) => void saveSettings({ density })} options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} />
        </Row>
      </Section>
      <Section title="Layout">
        <Row label="Reading pane" hint="Where an opened message appears.">
          <Segmented value={s.reading_pane} onChange={(reading_pane) => void saveSettings({ reading_pane })} options={[{ value: "right", label: "Right" }, { value: "bottom", label: "Bottom" }, { value: "off", label: "Off" }]} />
        </Row>
        <Row label="Conversation view" hint="Group replies with the message they answer.">
          <Toggle label="Conversation view" checked={s.conversations} onChange={(conversations) => void saveSettings({ conversations })} />
        </Row>
      </Section>
      <Section title="Sending">
        <Row label="Undo send" hint="Hold messages briefly so you can take them back.">
          <select className="select" value={s.undo_send_seconds} onChange={(event) => void saveSettings({ undo_send_seconds: Number(event.target.value) })}>
            {[0, 5, 10, 20, 30].map((value) => (
              <option key={value} value={value}>
                {value ? `${value} seconds` : "Off"}
              </option>
            ))}
          </select>
        </Row>
      </Section>
      <Section title="Privacy & notifications">
        <Row label="Load remote images automatically" hint="Off keeps senders from seeing when you open mail.">
          <Toggle label="Load remote images" checked={s.load_remote_images} onChange={(load_remote_images) => void saveSettings({ load_remote_images })} />
        </Row>
        <Row label="Desktop notifications" hint="Notify when new mail arrives while Poso is in the background. Reminders, event alerts and due to-dos always notify.">
          <Toggle
            label="Desktop notifications"
            checked={s.notify}
            onChange={async (notify) => {
              if (notify && (await requestNotificationPermission()) !== "granted") {
                toast("Notifications are blocked by the system.", { tone: "error" });
              }
              void saveSettings({ notify });
            }}
          />
        </Row>
      </Section>
    </>
  );
}

function AccountCard({ account }: { account: Account }) {
  const { boot, updateAccount, removeAccount, toast } = useMail();
  const [name, setName] = useState(account.display_name);
  const [password, setPassword] = useState("");
  const [signature, setSignature] = useState(account.signature);
  const [confirming, setConfirming] = useState(false);
  const editor = useRef<EditorHandle>(null);
  if (!boot) return null;
  return (
    <div className="account-card">
      <div className="account-card-head">
        <span className="account-dot lg" style={{ background: account.color }} />
        <div className="grow">
          <div className="account-card-name">{account.display_name}</div>
          <div className="account-card-email">
            {account.email} · {account.auth_type === "local" ? "Sample account" : account.auth_type.startsWith("oauth") ? "Browser sign-in" : "Password"} · {account.provider}
          </div>
        </div>
        {account.auth_type !== "local" ? (
          <button type="button" className="btn sm" onClick={() => void post(`/api/accounts/${account.id}/sync`).then(() => toast(`Syncing ${account.email}…`))}>
            <RefreshCw size={14} /> Sync
          </button>
        ) : null}
      </div>
      {account.last_error ? (
        <div className="banner danger">
          <AlertCircle size={15} />
          <span>{account.last_error}</span>
        </div>
      ) : account.auth_type !== "local" ? (
        <p className="set-hint">Last synced {relative(account.last_sync_at)}</p>
      ) : null}
      <div className="grid-2">
        <label className="field">
          <span>Display name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} onBlur={() => name.trim() && name !== account.display_name && void updateAccount(account.id, { display_name: name.trim() })} />
        </label>
        <label className="field">
          <span>Session</span>
          <select value={account.session_id} onChange={(event) => void updateAccount(account.id, { session_id: Number(event.target.value) })}>
            {boot.sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="field">
        <span>Color</span>
        <SwatchPicker value={account.color} onChange={(color) => void updateAccount(account.id, { color })} />
      </div>
      <div className="field">
        <span>Signature</span>
        <div className="signature-editor">
          <RichEditor ref={editor} docKey={account.id} initialHtml={account.signature} onChange={setSignature} onFiles={() => undefined} placeholder="Add a signature for this address" />
        </div>
        <div className="form-actions">
          <button type="button" className="btn sm primary" disabled={signature === account.signature} onClick={() => void updateAccount(account.id, { signature }).then(() => toast("Signature saved", { tone: "success" }))}>
            Save signature
          </button>
        </div>
      </div>
      <div className="account-card-foot">
        {account.auth_type === "password" ? (
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!password) return;
              void updateAccount(account.id, { password }).then(() => {
                setPassword("");
                toast("Password updated", { tone: "success" });
              });
            }}
          >
            <input type="password" placeholder="New password" value={password} onChange={(event) => setPassword(event.target.value)} />
            <button type="submit" className="btn sm">
              Update
            </button>
          </form>
        ) : null}
        <label className="check">
          <Toggle label="Sync" checked={account.sync_enabled} onChange={(sync_enabled) => void updateAccount(account.id, { sync_enabled })} /> Sync this account
        </label>
        <span className="grow" />
        {confirming ? (
          <>
            <span className="set-hint">Remove {account.email} and its local mail?</span>
            <button type="button" className="btn sm danger" onClick={() => void removeAccount(account.id)}>
              Remove
            </button>
            <button type="button" className="btn sm" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </>
        ) : (
          <button type="button" className="btn sm danger-ghost" onClick={() => setConfirming(true)}>
            <Trash2 size={14} /> Remove
          </button>
        )}
      </div>
    </div>
  );
}

function AccountsTab() {
  const { boot } = useMail();
  const [adding, setAdding] = useState(false);
  if (!boot) return null;
  return (
    <>
      <Section title="Add an account" description="Gmail, Outlook / Microsoft 365, Yahoo, iCloud, or any IMAP server.">
        {adding ? (
          <AccountForm onDone={() => setAdding(false)} />
        ) : (
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            <Plus size={15} /> Add account
          </button>
        )}
      </Section>
      {boot.sessions.map((session) => {
        const accounts = boot.accounts.filter((item) => item.session_id === session.id);
        return (
          <Section key={session.id} title={session.name} description={accounts.length ? `${accounts.length} account${accounts.length === 1 ? "" : "s"}` : "No accounts in this session yet."}>
            {accounts.map((account) => (
              <AccountCard key={account.id} account={account} />
            ))}
          </Section>
        );
      })}
    </>
  );
}

function SessionsTab() {
  const { boot, renameSession, createSession, deleteSession, switchSession } = useMail();
  const [name, setName] = useState("");
  if (!boot) return null;
  return (
    <>
      <Section title="Sessions" description="A session is a workspace — e.g. Business (x, y, z) and Personal (1, 2). Inbox, search, spam, rules, and labels stay inside the active session.">
        {boot.sessions.map((session, index) => {
          const accounts = boot.accounts.filter((item) => item.session_id === session.id);
          return (
            <div key={session.id} className="session-card">
              <div className="session-card-top">
                <span className="session-glyph" style={{ background: session.color }}>
                  <Layers size={15} />
                </span>
                <input
                  className="inline-input"
                  defaultValue={session.name}
                  aria-label="Session name"
                  onBlur={(event) => {
                    const value = event.target.value.trim();
                    if (value && value !== session.name) void renameSession(session.id, value);
                  }}
                />
                <span className="set-hint">Ctrl+{index + 1}</span>
                <span className="grow" />
                {session.id !== boot.active_session_id ? (
                  <button type="button" className="btn sm" onClick={() => void switchSession(session.id)}>
                    Switch to
                  </button>
                ) : (
                  <span className="pill">Active</span>
                )}
                <button type="button" className="btn sm danger-ghost" disabled={accounts.length > 0 || boot.sessions.length <= 1} title={accounts.length ? "Move this session's accounts first" : "Delete session"} onClick={() => void deleteSession(session.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
              <SwatchPicker value={session.color} onChange={(color) => void renameSession(session.id, session.name, color)} />
              <div className="session-accounts">
                {accounts.length ? (
                  accounts.map((item) => (
                    <span key={item.id} className="account-pill">
                      <span className="account-dot" style={{ background: item.color }} />
                      {item.email}
                    </span>
                  ))
                ) : (
                  <span className="set-hint">No accounts — add one or move one here from Accounts.</span>
                )}
              </div>
            </div>
          );
        })}
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            void createSession(name.trim());
            setName("");
          }}
        >
          <input placeholder="New session name, e.g. Side project" value={name} onChange={(event) => setName(event.target.value)} />
          <button type="submit" className="btn sm primary">
            <Plus size={14} /> Create session
          </button>
        </form>
      </Section>
    </>
  );
}

function LabelsTab() {
  const { sessionLabels, activeSession, createLabel, reload, run } = useMail();
  const [name, setName] = useState("");
  return (
    <Section title={`Labels in ${activeSession?.name ?? "this session"}`} description="Labels (Outlook calls them categories) work across every account in the session. A message can have many.">
      {sessionLabels.map((label) => (
        <div key={label.id} className="label-row">
          <span className="label-dot lg" style={{ background: label.color }} />
          <input
            className="inline-input"
            defaultValue={label.name}
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (value && value !== label.name) void run(async () => { await api(`/api/labels/${label.id}`, { method: "PATCH", body: JSON.stringify({ name: value }) }); await reload(); });
            }}
          />
          <SwatchPicker value={label.color} onChange={(color) => void run(async () => { await api(`/api/labels/${label.id}`, { method: "PATCH", body: JSON.stringify({ color }) }); await reload(); })} />
          <button type="button" className="btn sm danger-ghost" onClick={() => void run(async () => { await api(`/api/labels/${label.id}`, { method: "DELETE" }); await reload(); })}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          void createLabel(name.trim()).then(() => setName(""));
        }}
      >
        <input placeholder="New label" value={name} onChange={(event) => setName(event.target.value)} />
        <button type="submit" className="btn sm primary">
          <Plus size={14} /> Add label
        </button>
      </form>
    </Section>
  );
}

function SpamTab() {
  const { boot, activeSession } = useMail();
  const [blocks, setBlocks] = useState<BlockEntry[]>([]);
  useEffect(() => {
    if (!boot) return;
    api<{ entries: BlockEntry[] }>(`/api/blocklist?session_id=${boot.active_session_id}`)
      .then((data) => setBlocks(data.entries))
      .catch(() => setBlocks([]));
  }, [boot]);
  return (
    <>
      <Section title="How spam filtering works" description="Each session trains its own filter.">
        <ul className="bullets">
          <li>Provider junk folders from every account appear in the session's Spam view.</li>
          <li><b>Report spam</b> moves the message, blocks the sender, and trains the local filter.</li>
          <li><b>Not spam</b> restores it, allowlists the sender, and trains the filter the other way.</li>
          <li>After a few reports, a Bayesian filter files high-scoring mail automatically, with an Undo.</li>
          <li>Remote images and links are disabled for anything in Spam.</li>
        </ul>
      </Section>
      <Section title={`Blocked senders in ${activeSession?.name ?? ""}`}>
        {blocks.length === 0 ? <p className="set-hint">No blocked senders yet.</p> : null}
        {blocks.map((entry) => (
          <div key={entry.id} className="label-row">
            <Ban size={15} className="muted-icon" />
            <span className="grow">{entry.value}</span>
            <button type="button" className="btn sm" onClick={() => void api(`/api/blocklist/${entry.id}`, { method: "DELETE" }).then(() => setBlocks((current) => current.filter((item) => item.id !== entry.id)))}>
              Unblock
            </button>
          </div>
        ))}
      </Section>
    </>
  );
}

function SigninTab() {
  const { boot, saveSettings, toast } = useMail();
  const [googleId, setGoogleId] = useState(boot?.oauth.google_client_id ?? "");
  const [googleSecret, setGoogleSecret] = useState("");
  const [microsoftId, setMicrosoftId] = useState(boot?.oauth.microsoft_client_id ?? "");
  const [microsoftSecret, setMicrosoftSecret] = useState("");
  if (!boot) return null;
  return (
    <Section title="Browser sign-in (OAuth)" description="Needed for Outlook.com / Microsoft 365, and optional for Gmail. Register a desktop app with each provider and paste its client id here.">
      <p className="set-hint">
        Redirect URI for both: <code>{boot.oauth.redirect_uri}</code>
      </p>
      <div className="grid-2">
        <label className="field">
          <span>Google client id</span>
          <input value={googleId} onChange={(event) => setGoogleId(event.target.value)} />
        </label>
        <label className="field">
          <span>Google client secret</span>
          <input type="password" placeholder={boot.oauth.google_has_secret ? "Saved" : "Optional"} value={googleSecret} onChange={(event) => setGoogleSecret(event.target.value)} />
        </label>
        <label className="field">
          <span>Microsoft client id</span>
          <input value={microsoftId} onChange={(event) => setMicrosoftId(event.target.value)} />
        </label>
        <label className="field">
          <span>Microsoft client secret</span>
          <input type="password" placeholder={boot.oauth.microsoft_has_secret ? "Saved" : "Optional"} value={microsoftSecret} onChange={(event) => setMicrosoftSecret(event.target.value)} />
        </label>
      </div>
      <div className="form-actions">
        <button
          type="button"
          className="btn primary"
          onClick={() =>
            void saveSettings({ google_client_id: googleId, google_client_secret: googleSecret, microsoft_client_id: microsoftId, microsoft_client_secret: microsoftSecret }).then(() => {
              setGoogleSecret("");
              setMicrosoftSecret("");
              toast("Sign-in apps saved", { tone: "success" });
            })
          }
        >
          Save
        </button>
      </div>
    </Section>
  );
}

function AboutTab() {
  const { boot } = useMail();
  return (
    <Section title="Poso" description="A desktop mail client that keeps business and personal inboxes in separate sessions. Poso means post in Sesotho.">
      <dl className="about">
        <dt>App version</dt>
        <dd>{__APP_VERSION__}</dd>
        <dt>Mail engine</dt>
        <dd>{boot?.version}</dd>
        <dt>Stack</dt>
        <dd>Electron · React · FastAPI · SQLite FTS5</dd>
        <dt>Your data</dt>
        <dd>Stored locally in %APPDATA%\Session. Passwords and tokens live in Windows Credential Manager.</dd>
        <dt>Protocols</dt>
        <dd>IMAP (IDLE), SMTP, OAuth 2 / XOAUTH2 for Google and Microsoft</dd>
      </dl>
    </Section>
  );
}

export function Settings() {
  const { settingsOpen, closeSettings, settingsTab, openSettings } = useMail();
  return (
    <Modal open={settingsOpen} onClose={closeSettings} size="xl" bare className="settings">
      <nav className="settings-nav" aria-label="Settings sections">
        <h2>Settings</h2>
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} type="button" className={`settings-tab${settingsTab === tab.id ? " on" : ""}`} onClick={() => openSettings(tab.id)}>
              <Icon size={16} /> {tab.label}
            </button>
          );
        })}
      </nav>
      <div className="settings-body">
        <div className="settings-top">
          <h2>{TABS.find((tab) => tab.id === settingsTab)?.label}</h2>
          <button type="button" className="btn sm" onClick={closeSettings}>
            Done
          </button>
        </div>
        <div className="settings-scroll">
          {settingsTab === "general" ? <GeneralTab /> : null}
          {settingsTab === "accounts" ? <AccountsTab /> : null}
          {settingsTab === "sessions" ? <SessionsTab /> : null}
          {settingsTab === "labels" ? <LabelsTab /> : null}
          {settingsTab === "rules" ? <RulesTab /> : null}
          {settingsTab === "spam" ? <SpamTab /> : null}
          {settingsTab === "signin" ? <SigninTab /> : null}
          {settingsTab === "data" ? <DataTab /> : null}
          {settingsTab === "audit" ? <AuditTab /> : null}
          {settingsTab === "about" ? <AboutTab /> : null}
        </div>
      </div>
    </Modal>
  );
}
