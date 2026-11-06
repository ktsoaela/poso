import { useState } from "react";
import { Briefcase, Home, Plus, Sparkles } from "lucide-react";
import { useMail } from "../state";
import { AccountForm } from "./AccountForm";

const STEPS = [
  { id: 1, label: "Connect" },
  { id: 2, label: "App password" },
  { id: 3, label: "Sessions" },
] as const;

export function Setup({ onFinish }: { onFinish: () => void }) {
  const { boot, renameSession, seedDemo, createSession } = useMail();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [sessionName, setSessionName] = useState("");
  if (!boot) return null;
  const connected = boot.accounts.length > 0;

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
        <button
          type="button"
          className="btn ghost-light"
          onClick={() => {
            void seedDemo().then((ok) => {
              if (ok) onFinish();
            });
          }}
        >
          <Sparkles size={16} /> Explore with sample mail
        </button>
      </div>
      <div className="setup-card">
        <div className="walk-progress" role="tablist" aria-label="Setup steps">
          {STEPS.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={step === item.id} className={`walk-step${step === item.id ? " on" : ""}`} onClick={() => setStep(item.id)}>
              <span>{item.id}</span>
              {item.label}
            </button>
          ))}
        </div>

        {step === 1 ? (
          <>
            <h2>1 · Connect a real address</h2>
            <p className="set-hint">Pick a provider. Gmail and Outlook can sign in in the browser. Yahoo, iCloud, and other servers continue to an app password. Nothing syncs until an account connects.</p>
          </>
        ) : null}
        {step === 2 ? (
          <>
            <h2>2 · Use an app password</h2>
            <p className="set-hint">This is the path when browser sign-in is not set up. Choose which session receives the address, then paste the mailbox password.</p>
            <button type="button" className="link-btn" onClick={() => setStep(1)}>
              Back to provider
            </button>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <h2>3 · Name your sessions</h2>
            <p className="set-hint">Business and Personal are already here. Rename them, add another, then open the inbox.</p>
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
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setStep(connected ? 2 : 1)}>
                Back
              </button>
              <button type="button" className="btn primary" disabled={!connected} onClick={onFinish}>
                Open inbox
              </button>
            </div>
            {connected ? null : <p className="set-hint">Connect an address in step 1 or 2 before opening the inbox.</p>}
          </>
        ) : (
          <AccountForm part={step === 1 ? "choose" : "password"} onUsePassword={() => setStep(2)} onDone={() => setStep(3)} />
        )}
      </div>
    </div>
  );
}
