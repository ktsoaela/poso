import { useState } from "react";
import { Briefcase, Home, Plus, Sparkles } from "lucide-react";
import { useMail } from "../state";
import { AccountForm } from "./AccountForm";

export function Setup() {
  const { boot, renameSession, seedDemo, createSession } = useMail();
  const [sessionName, setSessionName] = useState("");
  if (!boot) return null;

  return (
    <div className="setup-page">
      <div className="setup-hero">
        <div className="brand big">
          <span className="brand-mark" aria-hidden>
            <svg viewBox="0 0 32 32" width="22" height="22">
              <path d="M5 9.5 16 17l11-7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="4" y="7" width="24" height="18" rx="4.5" fill="none" stroke="currentColor" strokeWidth="2.6" />
            </svg>
          </span>
          <span className="brand-word">Poso</span>
        </div>
        <h1>All your inboxes. Neatly kept apart.</h1>
        <p>
          Group addresses into <b>sessions</b> — Business for x, y and z, Personal for 1 and 2 — and switch the whole workspace in one click. Search, spam, rules, and labels stay inside the session you're in.
        </p>
        <ul className="setup-points">
          <li>Gmail, Outlook / Microsoft 365, Yahoo, iCloud, and any IMAP server</li>
          <li>Rich HTML mail with images blocked until you allow them</li>
          <li>Rules, labels, snooze, scheduled send, undo send</li>
          <li>Import & export MBOX / EML / JSON, with a full audit log</li>
        </ul>
        <button type="button" className="btn ghost-light" onClick={() => void seedDemo()}>
          <Sparkles size={16} /> Explore with sample mail
        </button>
      </div>
      <div className="setup-card">
        <h2>1 · Name your sessions</h2>
        <div className="setup-sessions">
          {boot.sessions.map((session, index) => {
            const Icon = index === 0 ? Briefcase : index === 1 ? Home : Plus;
            return (
              <label key={session.id} className="setup-session">
                <span className="session-glyph" style={{ background: session.color }}>
                  <Icon size={15} />
                </span>
                <input
                  defaultValue={session.name}
                  aria-label={`${session.name} name`}
                  onBlur={(event) => {
                    const name = event.target.value.trim();
                    if (name && name !== session.name) void renameSession(session.id, name);
                  }}
                />
              </label>
            );
          })}
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!sessionName.trim()) return;
              void createSession(sessionName.trim());
              setSessionName("");
            }}
          >
            <input placeholder="Add another session" value={sessionName} onChange={(event) => setSessionName(event.target.value)} />
            <button type="submit" className="btn sm">
              <Plus size={14} /> Add
            </button>
          </form>
        </div>
        <h2>2 · Connect a real address</h2>
        <p className="set-hint">
          This is the normal start. Poso opens with two empty sessions, Business and Personal. Add a Gmail, Outlook, or IMAP address here. Nothing is synced until you connect one. Sample mail is optional, stays on this computer, and can be removed later from Settings without touching a real account or its audit history.
        </p>
        <AccountForm />
      </div>
    </div>
  );
}
