import { useState } from "react";
import { ChevronDown, KeyRound, Lock, Server } from "lucide-react";
import { useMail } from "../state";

const PROVIDER_MARKS: Record<string, { bg: string; letter: string }> = {
  gmail: { bg: "#ea4335", letter: "G" },
  outlook: { bg: "#0078d4", letter: "O" },
  yahoo: { bg: "#6001d2", letter: "Y" },
  icloud: { bg: "#3b82f6", letter: "i" },
  custom: { bg: "#64748b", letter: "@" },
};

export function AccountForm({ defaultSessionId, onDone }: { defaultSessionId?: number; onDone?: () => void }) {
  const { boot, providers, addAccount, startOAuth } = useMail();
  const [provider, setProvider] = useState("gmail");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [sessionId, setSessionId] = useState<number>(defaultSessionId ?? boot?.active_session_id ?? boot?.sessions[0]?.id ?? 0);
  const [advanced, setAdvanced] = useState(false);
  const [hosts, setHosts] = useState({ imap_host: "", imap_port: "", smtp_host: "", smtp_port: "", username: "" });
  const [busy, setBusy] = useState(false);
  const preset = providers.find((item) => item.id === provider);
  if (!boot) return null;

  return (
    <form
      className="account-form"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        void addAccount({
          session_id: sessionId,
          email,
          password,
          display_name: displayName,
          provider,
          username: hosts.username,
          imap_host: hosts.imap_host,
          imap_port: hosts.imap_port ? Number(hosts.imap_port) : null,
          smtp_host: hosts.smtp_host,
          smtp_port: hosts.smtp_port ? Number(hosts.smtp_port) : null,
        })
          .then((ok) => {
            if (ok) {
              setEmail("");
              setPassword("");
              onDone?.();
            }
          })
          .finally(() => setBusy(false));
      }}
    >
      <div className="provider-grid" role="radiogroup" aria-label="Provider">
        {providers.map((item) => {
          const mark = PROVIDER_MARKS[item.id] ?? PROVIDER_MARKS.custom;
          return (
            <button key={item.id} type="button" role="radio" aria-checked={provider === item.id} className={`provider${provider === item.id ? " on" : ""}`} onClick={() => setProvider(item.id)}>
              <span className="provider-mark" style={{ background: mark.bg }}>
                {mark.letter}
              </span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
      {preset ? <p className="hint-line">{preset.hint}</p> : null}

      {preset?.oauth ? (
        <button type="button" className="btn oauth" onClick={() => void startOAuth(preset.oauth as string, sessionId).then(() => onDone?.())}>
          <KeyRound size={16} /> Sign in with {preset.oauth === "google" ? "Google" : "Microsoft"} in your browser
        </button>
      ) : null}
      {preset?.oauth ? <div className="or-line"><span>or use an app password</span></div> : null}

      <div className="grid-2">
        <label className="field">
          <span>Session</span>
          <select value={sessionId} onChange={(event) => setSessionId(Number(event.target.value))}>
            {boot.sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Your name</span>
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Shown to recipients" />
        </label>
      </div>
      <label className="field">
        <span>Email address</span>
        <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" />
      </label>
      <label className="field">
        <span>
          <Lock size={12} /> Password or app password
        </span>
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Stored in Windows Credential Manager" />
      </label>
      <button type="button" className="link-btn" onClick={() => setAdvanced((value) => !value)}>
        <Server size={14} /> Server settings <ChevronDown size={14} className={advanced ? "flip" : ""} />
      </button>
      {advanced ? (
        <div className="grid-2">
          <label className="field">
            <span>IMAP host</span>
            <input value={hosts.imap_host} placeholder={preset?.imap_host} onChange={(event) => setHosts({ ...hosts, imap_host: event.target.value })} />
          </label>
          <label className="field">
            <span>IMAP port</span>
            <input value={hosts.imap_port} placeholder={String(preset?.imap_port ?? 993)} onChange={(event) => setHosts({ ...hosts, imap_port: event.target.value })} />
          </label>
          <label className="field">
            <span>SMTP host</span>
            <input value={hosts.smtp_host} placeholder={preset?.smtp_host} onChange={(event) => setHosts({ ...hosts, smtp_host: event.target.value })} />
          </label>
          <label className="field">
            <span>SMTP port</span>
            <input value={hosts.smtp_port} placeholder={String(preset?.smtp_port ?? 587)} onChange={(event) => setHosts({ ...hosts, smtp_port: event.target.value })} />
          </label>
          <label className="field span-2">
            <span>Username (if different from email)</span>
            <input value={hosts.username} onChange={(event) => setHosts({ ...hosts, username: event.target.value })} />
          </label>
        </div>
      ) : null}
      <div className="form-actions">
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Checking sign-in…" : "Add account"}
        </button>
      </div>
    </form>
  );
}
