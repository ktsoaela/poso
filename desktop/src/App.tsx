import { useEffect } from "react";
import { CommandPalette } from "./components/CommandPalette";
import { Composer } from "./components/Composer";
import { FolderPane } from "./components/FolderPane";
import { MessageList } from "./components/MessageList";
import { Reader } from "./components/Reader";
import { SessionSwitcher } from "./components/SessionSwitcher";
import { SpamQueue } from "./components/SpamQueue";
import { Setup } from "./screens/Setup";
import { Settings } from "./screens/Settings";
import { MailProvider, useMail } from "./state";

function Shell() {
  const mail = useMail();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target instanceof Element ? event.target : null;
      const typing = Boolean(target?.closest("input, textarea, select, [contenteditable='true']"));
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "k") {
        event.preventDefault();
        mail.setPaletteOpen(!mail.paletteOpen);
        return;
      }
      if (event.key === "Escape") {
        if (mail.paletteOpen) mail.setPaletteOpen(false);
        else if (mail.settingsOpen) mail.setSettingsOpen(false);
        else if (mail.compose) mail.closeCompose();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && mail.compose) {
        event.preventDefault();
        void mail.send();
        return;
      }
      if (!mail.boot) return;
      if ((event.ctrlKey || event.metaKey) && /^[1-9]$/.test(event.key)) {
        const session = mail.boot.sessions[Number(event.key) - 1];
        if (session) {
          event.preventDefault();
          void mail.switchSession(session.id);
        }
        return;
      }
      if (typing || mail.compose || mail.paletteOpen || mail.settingsOpen) return;
      if (key === "c") mail.openCompose();
      else if (key === "r") mail.reply(false);
      else if (key === "e") void mail.archive();
      else if (key === "#") void mail.trash();
      else if (key === "j") mail.moveSelection(1);
      else if (key === "k") mail.moveSelection(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mail]);

  if (mail.loading) {
    return (
      <div className="boot">
        <p>Opening Session…</p>
      </div>
    );
  }
  if (mail.error || !mail.boot) {
    return (
      <div className="boot">
        <div className="empty-card">
          <h2>The mail engine isn't running</h2>
          <p>{mail.error}</p>
          <button className="btn primary" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (mail.boot.accounts.length === 0) {
    return (
      <>
        <Setup />
        <Settings />
        <Toasts />
      </>
    );
  }
  const spam = mail.mailbox.kind === "role" && mail.mailbox.role === "spam";
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="mark">S</span>
          <span className="word">Session</span>
        </div>
        <SessionSwitcher />
        <button className="btn primary" onClick={() => mail.openCompose()}>
          Compose
        </button>
        <FolderPane />
        <p className="hint">Ctrl+K to jump</p>
      </aside>
      {spam ? <SpamQueue /> : <MessageList />}
      <Reader />
      <Composer />
      <CommandPalette />
      <Settings />
      <Toasts />
    </div>
  );
}

function Toasts() {
  const { toasts, dismissToast, undoSpam } = useMail();
  if (!toasts.length) return null;
  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div className="toast" key={toast.id} role="status">
          <span>{toast.text}</span>
          {toast.undoId ? (
            <button
              onClick={() => {
                void undoSpam(toast.undoId as number);
                dismissToast(toast.id);
              }}
            >
              Undo
            </button>
          ) : (
            <button onClick={() => dismissToast(toast.id)}>Dismiss</button>
          )}
        </div>
      ))}
    </div>
  );
}

export function App() {
  return (
    <MailProvider>
      <Shell />
    </MailProvider>
  );
}
