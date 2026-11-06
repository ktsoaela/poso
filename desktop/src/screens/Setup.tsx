import { useState } from "react";
import { useMail } from "../state";

export function Setup() {
  const { boot, providers, renameSession, addAccount, seedDemo, startOAuth, createSession } = useMail();
  const [provider, setProvider] = useState("gmail");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [sessionId, setSessionId] = useState<number | "">(boot?.sessions[0]?.id ?? "");
  const [advanced, setAdvanced] = useState(false);
  const [hosts, setHosts] = useState({ imap_host: "", imap_port: "", smtp_host: "", smtp_port: "" });
  const [busy, setBusy] = useState(false);
  const [sessionName, setSessionName] = useState("");
  const preset = providers.find((item) => item.id === provider);

  if (!boot) return null;

  return (
    <main className="setup stack">
      <p className="meta">Session</p>
      <h1>Keep work and personal mail apart.</h1>
      <p className="lede">
        A session is a workspace. Business can hold several addresses, personal can hold others, and one click swaps the whole inbox.
      </p>
      <div className="stack">
        {boot.sessions.map((session) => (
          <label className="field" key={session.id}>
            <span>Session name</span>
            <input
              defaultValue={session.name}
              aria-label={`${session.name} name`}
              onBlur={(event) => {
                const name = event.target.value.trim();
                if (name && name !== session.name) void renameSession(session.id, name);
              }}
            />
          </label>
        ))}
        <div className="row-actions">
          <input
            placeholder="Another session"
            value={sessionName}
            aria-label="New session name"
            onChange={(event) => setSessionName(event.target.value)}
          />
          <button
            className="btn ghost"
            type="button"
            onClick={() => {
              if (!sessionName.trim()) return;
              void createSession(sessionName.trim());
              setSessionName("");
            }}
          >
            Add session
          </button>
        </div>
      </div>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          void addAccount({
            session_id: sessionId,
            email,
            password,
            display_name: displayName,
            provider,
            imap_host: hosts.imap_host,
            imap_port: hosts.imap_port ? Number(hosts.imap_port) : null,
            smtp_host: hosts.smtp_host,
            smtp_port: hosts.smtp_port ? Number(hosts.smtp_port) : null,
          }).finally(() => setBusy(false));
        }}
      >
        <h2>Add an account</h2>
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
          <span>Provider</span>
          <select value={provider} onChange={(event) => setProvider(event.target.value)}>
            {providers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        {preset ? <p className="meta">{preset.hint}</p> : null}
        <div className="grid-2">
          <label className="field">
            <span>Email</span>
            <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label className="field">
            <span>Your name</span>
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>Password or app password</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <button type="button" className="text-btn" onClick={() => setAdvanced((value) => !value)}>
          {advanced ? "Hide server settings" : "Server settings"}
        </button>
        {advanced ? (
          <div className="grid-2">
            <label className="field">
              <span>IMAP host</span>
              <input value={hosts.imap_host} onChange={(event) => setHosts({ ...hosts, imap_host: event.target.value })} />
            </label>
            <label className="field">
              <span>IMAP port</span>
              <input value={hosts.imap_port} onChange={(event) => setHosts({ ...hosts, imap_port: event.target.value })} />
            </label>
            <label className="field">
              <span>SMTP host</span>
              <input value={hosts.smtp_host} onChange={(event) => setHosts({ ...hosts, smtp_host: event.target.value })} />
            </label>
            <label className="field">
              <span>SMTP port</span>
              <input value={hosts.smtp_port} onChange={(event) => setHosts({ ...hosts, smtp_port: event.target.value })} />
            </label>
          </div>
        ) : null}
        <div className="row-actions">
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "Checking sign-in…" : "Add account"}
          </button>
          <button className="btn ghost" type="button" onClick={() => void startOAuth("google")}>
            Sign in with Google
          </button>
          <button className="btn ghost" type="button" onClick={() => void startOAuth("microsoft")}>
            Sign in with Microsoft
          </button>
        </div>
      </form>
      <button className="btn ghost" type="button" onClick={() => void seedDemo()}>
        Explore with sample mail
      </button>
    </main>
  );
}
