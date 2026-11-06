import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowDownUp,
  Check,
  CheckCircle2,
  CircleDot,
  Filter,
  History,
  Inbox,
  Keyboard,
  Layers,
  Mail,
  Moon,
  PenSquare,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldAlert,
  Tag,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { relative } from "../format";
import { useMail } from "../state";
import { Kbd, Modal } from "./ui";

const UI_VERSION = __APP_VERSION__;

export function StatusBar() {
  const { boot, connected, syncing, sessionAccounts, activeSession, total, mailboxTitle, setHelpOpen, openSettings } = useMail();
  if (!boot) return null;
  const errors = sessionAccounts.filter((item) => item.last_error);
  const synced = sessionAccounts
    .map((item) => item.last_sync_at)
    .filter(Boolean)
    .sort()
    .pop() as string | undefined;
  const local = sessionAccounts.every((item) => item.auth_type === "local");
  return (
    <footer className="statusbar">
      <span className={`status-item ${connected ? "ok" : "bad"}`} title={connected ? "Connected to the local mail engine" : "Reconnecting to the mail engine"}>
        {connected ? <Wifi size={13} /> : <WifiOff size={13} />}
        {connected ? "Engine online" : "Reconnecting…"}
      </span>
      <span className="status-item">
        {syncing ? <RefreshCw size={13} className="spin" /> : <CheckCircle2 size={13} />}
        {syncing ? "Syncing…" : local ? "Sample mail (offline)" : `Synced ${relative(synced ?? null)}`}
      </span>
      {errors.length ? (
        <button type="button" className="status-item warn" onClick={() => openSettings("accounts")}>
          <AlertCircle size={13} /> {errors.length} account{errors.length === 1 ? "" : "s"} need attention
        </button>
      ) : null}
      <span className="status-item muted">
        <CircleDot size={13} style={{ color: activeSession?.color }} />
        {activeSession?.name} · {sessionAccounts.length} account{sessionAccounts.length === 1 ? "" : "s"} · {mailboxTitle}: {total.toLocaleString()}
      </span>
      <span className="grow" />
      <button type="button" className="status-item muted" onClick={() => setHelpOpen(true)}>
        <Keyboard size={13} /> Shortcuts <Kbd>?</Kbd>
      </button>
      <button type="button" className="status-item muted" onClick={() => openSettings("about")} title={`Engine ${boot.version} · UI ${UI_VERSION}`}>
        Session v{UI_VERSION}
      </button>
    </footer>
  );
}

interface PaletteItem {
  id: string;
  label: string;
  group: string;
  icon: LucideIcon;
  hint?: string;
  run: () => void;
}

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, boot, sessionAccounts, sessionLabels, switchSession, setMailbox, openCompose, openSettings, saveSettings, syncNow, setQuery, setHelpOpen } = useMail();
  const [filter, setFilter] = useState("");
  const [cursor, setCursor] = useState(0);

  const items = useMemo<PaletteItem[]>(() => {
    if (!boot) return [];
    const list: PaletteItem[] = [
      { id: "compose", group: "Actions", label: "New message", icon: PenSquare, hint: "C", run: () => openCompose() },
      { id: "sync", group: "Actions", label: "Check for new mail", icon: RefreshCw, run: () => void syncNow() },
      { id: "theme", group: "Actions", label: "Toggle dark mode", icon: Moon, run: () => void saveSettings({ theme: document.documentElement.dataset.theme === "dark" ? "light" : "dark" }) },
      { id: "help", group: "Actions", label: "Keyboard shortcuts", icon: Keyboard, hint: "?", run: () => setHelpOpen(true) },
      ...boot.sessions.map((session, index) => ({
        id: `session-${session.id}`,
        group: "Sessions",
        label: `Switch to ${session.name}`,
        icon: Layers,
        hint: index < 9 ? `Ctrl ${index + 1}` : undefined,
        run: () => void switchSession(session.id),
      })),
      { id: "inbox", group: "Go to", label: "Inbox", icon: Inbox, run: () => setMailbox({ kind: "role", role: "inbox" }) },
      { id: "sent", group: "Go to", label: "Sent", icon: Send, run: () => setMailbox({ kind: "role", role: "sent" }) },
      { id: "spam", group: "Go to", label: "Spam", icon: ShieldAlert, run: () => setMailbox({ kind: "role", role: "spam" }) },
      { id: "all", group: "Go to", label: "All mail", icon: Mail, run: () => setMailbox({ kind: "role", role: "everything" }) },
      ...sessionLabels.map((label) => ({ id: `label-${label.id}`, group: "Labels", label: label.name, icon: Tag, run: () => setMailbox({ kind: "label", labelId: label.id }) })),
      ...sessionAccounts.map((account) => ({
        id: `account-${account.id}`,
        group: "Accounts",
        label: `Inbox for ${account.email}`,
        icon: Mail,
        run: () => setMailbox({ kind: "role", role: "inbox", accountId: account.id }),
      })),
      { id: "settings", group: "Settings", label: "Settings", icon: Settings, run: () => openSettings("general") },
      { id: "rules", group: "Settings", label: "Rules & filters", icon: Filter, run: () => openSettings("rules") },
      { id: "data", group: "Settings", label: "Import & export", icon: ArrowDownUp, run: () => openSettings("data") },
      { id: "audit", group: "Settings", label: "Audit log", icon: History, run: () => openSettings("audit") },
    ];
    return list;
  }, [boot, sessionAccounts, sessionLabels, switchSession, setMailbox, openCompose, openSettings, saveSettings, syncNow, setHelpOpen]);

  const needle = filter.trim().toLowerCase();
  const visible = items.filter((item) => item.label.toLowerCase().includes(needle) || item.group.toLowerCase().includes(needle));
  const searchItem: PaletteItem | null = needle
    ? { id: "search", group: "Search", label: `Search mail for “${filter.trim()}”`, icon: Search, run: () => setQuery(filter.trim()) }
    : null;
  const all = searchItem ? [...visible, searchItem] : visible;

  useEffect(() => {
    setCursor(0);
  }, [filter, paletteOpen]);

  if (!paletteOpen) return null;
  const close = () => {
    setPaletteOpen(false);
    setFilter("");
  };
  let lastGroup = "";
  return (
    <div className="overlay top" onMouseDown={close}>
      <div className="palette" role="dialog" aria-label="Command palette" onMouseDown={(event) => event.stopPropagation()}>
        <div className="palette-input">
          <Search size={17} />
          <input
            autoFocus
            placeholder="Type a command, session, label, or search…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setCursor((value) => Math.min(all.length - 1, value + 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setCursor((value) => Math.max(0, value - 1));
              } else if (event.key === "Enter" && all[cursor]) {
                event.preventDefault();
                all[cursor].run();
                close();
              } else if (event.key === "Escape") {
                close();
              }
            }}
          />
          <Kbd>Esc</Kbd>
        </div>
        <div className="palette-list">
          {all.map((item, index) => {
            const header = item.group !== lastGroup ? item.group : "";
            lastGroup = item.group;
            const Icon = item.icon;
            return (
              <div key={item.id}>
                {header ? <div className="menu-title">{header}</div> : null}
                <button
                  type="button"
                  className={`palette-item${index === cursor ? " on" : ""}`}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => {
                    item.run();
                    close();
                  }}
                >
                  <Icon size={16} />
                  <span>{item.label}</span>
                  {item.hint ? <Kbd>{item.hint}</Kbd> : null}
                </button>
              </div>
            );
          })}
          {!all.length ? <p className="menu-note">No matches.</p> : null}
        </div>
      </div>
    </div>
  );
}

const SHORTCUTS: [string, [string, string][]][] = [
  [
    "Navigation",
    [
      ["J / K", "Next / previous conversation"],
      ["Enter", "Open selected"],
      ["/", "Search"],
      ["Ctrl K", "Command palette"],
      ["Ctrl 1–9", "Switch session"],
      ["Esc", "Close / back"],
    ],
  ],
  [
    "Actions",
    [
      ["C", "Compose"],
      ["R", "Reply"],
      ["A", "Reply all"],
      ["F", "Forward"],
      ["E", "Archive"],
      ["#", "Delete"],
      ["!", "Report spam"],
      ["S", "Flag / unflag"],
      ["X", "Select conversation"],
      ["Shift U", "Mark unread"],
      ["Shift I", "Mark read"],
    ],
  ],
  [
    "Composer",
    [
      ["Ctrl Enter", "Send"],
      ["Ctrl B / I / U", "Bold / italic / underline"],
      ["Ctrl K", "Insert link"],
      ["Esc", "Close and keep draft"],
    ],
  ],
];

export function ShortcutsHelp() {
  const { helpOpen, setHelpOpen } = useMail();
  return (
    <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title="Keyboard shortcuts" size="lg">
      <div className="shortcut-grid">
        {SHORTCUTS.map(([group, rows]) => (
          <div key={group}>
            <h4>{group}</h4>
            {rows.map(([keys, label]) => (
              <div key={label} className="shortcut-row">
                <span>{label}</span>
                <span className="keys">
                  {keys.split(" / ").map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function Toasts() {
  const { toasts, dismissToast } = useMail();
  if (!toasts.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div className={`toast ${toast.tone ?? ""}`} key={toast.id}>
          {toast.tone === "success" ? <Check size={15} /> : toast.tone === "error" ? <AlertCircle size={15} /> : null}
          <span>{toast.text}</span>
          {toast.action ? (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                toast.action?.run();
                dismissToast(toast.id);
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
          <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => dismissToast(toast.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
