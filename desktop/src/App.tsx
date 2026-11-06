import { useEffect, useState } from "react";
import { MailWarning } from "lucide-react";
import { CommandPalette, ShortcutsHelp, StatusBar, Toasts } from "./components/Chrome";
import { Composer } from "./components/Composer";
import { MessageList } from "./components/MessageList";
import { Reader } from "./components/Reader";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { Setup } from "./screens/Setup";
import { Settings } from "./screens/Settings";
import { CalendarView } from "./screens/organizer/Calendar";
import { NotesView } from "./screens/organizer/Notes";
import { PeopleView } from "./screens/organizer/People";
import { RemindersView } from "./screens/organizer/Reminders";
import { TasksView } from "./screens/organizer/Tasks";
import { APP_VIEWS, MailProvider, useMail } from "./state";

function useShortcuts() {
  const mail = useMail();
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target instanceof Element ? event.target : null;
      const typing = Boolean(target?.closest("input, textarea, select, [contenteditable='true']"));
      const key = event.key;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && key.toLowerCase() === "k" && !typing) {
        event.preventDefault();
        mail.setPaletteOpen(!mail.paletteOpen);
        return;
      }
      if (mod && key === "Enter" && mail.compose) {
        event.preventDefault();
        void mail.send();
        return;
      }
      if (key === "Escape") {
        if (mail.paletteOpen) mail.setPaletteOpen(false);
        else if (mail.helpOpen) mail.setHelpOpen(false);
        else if (mail.settingsOpen) mail.closeSettings();
        else if (mail.compose) mail.closeCompose();
        else if (mail.checked.size) mail.setChecked(new Set());
        else if (!typing && mail.selectedId != null && mail.boot?.settings.reading_pane === "off") mail.select(null);
        return;
      }
      if (!mail.boot) return;
      if (event.altKey && !mod && /^[1-6]$/.test(key)) {
        event.preventDefault();
        mail.setView(APP_VIEWS[Number(key) - 1]);
        return;
      }
      if (mod && /^[1-9]$/.test(key)) {
        const session = mail.boot.sessions[Number(key) - 1];
        if (session) {
          event.preventDefault();
          void mail.switchSession(session.id);
        }
        return;
      }
      if (mod && key.toLowerCase() === "p" && mail.detail && !typing) {
        event.preventDefault();
        import("./format").then(({ printMessage }) => mail.detail && printMessage(mail.detail));
        return;
      }
      if (mail.view !== "mail") {
        if (!typing && !mod && !event.altKey && key === "?") mail.setHelpOpen(true);
        return;
      }
      if (typing || mod || event.altKey || mail.compose || mail.paletteOpen || mail.settingsOpen || mail.helpOpen) return;
      const ids = mail.checked.size ? undefined : mail.selectedId != null ? [mail.selectedId] : undefined;
      const has = Boolean(mail.checked.size || mail.selectedId != null);
      switch (key) {
        case "c":
          mail.openCompose();
          break;
        case "r":
          mail.reply(false);
          break;
        case "a":
          mail.reply(true);
          break;
        case "f":
          mail.forward();
          break;
        case "e":
          if (has) void mail.act("archive", ids);
          break;
        case "#":
        case "Delete":
          if (has) void mail.act("trash", ids);
          break;
        case "!":
          if (has) void mail.act("spam", ids);
          break;
        case "s":
          if (mail.detail) void mail.act(mail.detail.flagged ? "unflag" : "flag", [mail.detail.id]);
          break;
        case "U":
          if (has) void mail.act("unread", ids);
          break;
        case "I":
          if (has) void mail.act("read", ids);
          break;
        case "x":
          if (mail.selectedId != null) {
            const row = mail.rows.find((item) => item.threadIds?.includes(mail.selectedId as number));
            if (row) mail.toggleCheck(row.id);
          }
          break;
        case "j":
        case "ArrowDown":
          event.preventDefault();
          mail.moveSelection(1);
          break;
        case "k":
        case "ArrowUp":
          event.preventDefault();
          mail.moveSelection(-1);
          break;
        case "?":
          mail.setHelpOpen(true);
          break;
        default:
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mail]);
}

function Workspace() {
  const mail = useMail();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("session.sidebar") === "collapsed");
  useShortcuts();
  const pane = mail.boot?.settings.reading_pane ?? "right";
  const reading = mail.selectedId != null;

  useEffect(() => {
    localStorage.setItem("session.sidebar", collapsed ? "collapsed" : "open");
  }, [collapsed]);

  return (
    <div className="app">
      <Topbar />
      <div className={`workspace${collapsed ? " sidebar-collapsed" : ""}`}>
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} />
        {mail.view === "mail" ? (
          <main className={`mail-area pane-${pane}${pane === "off" && reading ? " reading" : ""}`}>
            {pane === "off" ? (
              reading ? <Reader onBack={() => mail.select(null)} /> : <MessageList />
            ) : (
              <>
                <MessageList />
                <Reader />
              </>
            )}
          </main>
        ) : (
          <main className="org-area">
            {mail.view === "calendar" ? <CalendarView /> : null}
            {mail.view === "people" ? <PeopleView /> : null}
            {mail.view === "tasks" ? <TasksView /> : null}
            {mail.view === "notes" ? <NotesView /> : null}
            {mail.view === "reminders" ? <RemindersView /> : null}
          </main>
        )}
      </div>
      <StatusBar />
      <Composer />
    </div>
  );
}

function Shell() {
  const mail = useMail();
  const [keepSetup, setKeepSetup] = useState<boolean | null>(null);
  if (mail.loading) {
    return (
      <div className="boot">
        <span className="spinner" />
        <p>Opening Poso…</p>
      </div>
    );
  }
  if (mail.error || !mail.boot) {
    return (
      <div className="boot">
        <div className="boot-card">
          <MailWarning size={30} />
          <h2>The mail engine isn't running</h2>
          <p>{mail.error}</p>
          <p className="set-hint">In development, start it with <code>.\scripts\dev.ps1</code>.</p>
          <button className="btn primary" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (mail.boot && keepSetup === null) {
    setKeepSetup(mail.boot.accounts.length === 0);
  }
  const showSetup = keepSetup === null ? mail.boot.accounts.length === 0 : keepSetup;
  return (
    <>
      {showSetup ? <Setup onFinish={() => setKeepSetup(false)} /> : <Workspace />}
      <Settings />
      <CommandPalette />
      <ShortcutsHelp />
      <Toasts />
    </>
  );
}

export function App() {
  return (
    <MailProvider>
      <Shell />
    </MailProvider>
  );
}
