import { useEffect, useRef, useState } from "react";
import {
  Briefcase,
  Check,
  ChevronDown,
  CircleHelp,
  Command,
  Home,
  Layers,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Sun,
  UserPlus,
  X,
} from "lucide-react";
import { SEARCH_HINTS } from "../format";
import { useMail } from "../state";
import { IconButton, Kbd, MenuDivider, MenuItem, Popover, useDismiss } from "./ui";

function sessionIcon(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes("business") || lower.includes("work")) return Briefcase;
  if (lower.includes("personal") || lower.includes("home") || lower.includes("family")) return Home;
  return Layers;
}

export function SessionMenu() {
  const { boot, activeSession, switchSession, openSettings } = useMail();
  if (!boot || !activeSession) return null;
  const ActiveIcon = sessionIcon(activeSession.name);
  const count = boot.accounts.filter((item) => item.session_id === activeSession.id).length;
  return (
    <Popover
      className="session-pop"
      trigger={({ open, toggle }) => (
        <button type="button" className={`session-trigger${open ? " open" : ""}`} onClick={toggle} aria-haspopup="menu" aria-expanded={open}>
          <span className="session-glyph" style={{ background: activeSession.color }}>
            <ActiveIcon size={15} strokeWidth={2.2} />
          </span>
          <span className="session-text">
            <strong>{activeSession.name}</strong>
            <span>
              {count} account{count === 1 ? "" : "s"}
            </span>
          </span>
          <ChevronDown size={16} className="chev" />
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="menu-title">Switch session</div>
          {boot.sessions.map((session, index) => {
            const Icon = sessionIcon(session.name);
            const accounts = boot.accounts.filter((item) => item.session_id === session.id);
            const active = session.id === boot.active_session_id;
            return (
              <button
                key={session.id}
                type="button"
                className={`session-option${active ? " active" : ""}`}
                onClick={() => {
                  close();
                  if (!active) void switchSession(session.id);
                }}
              >
                <span className="session-glyph" style={{ background: session.color }}>
                  <Icon size={15} strokeWidth={2.2} />
                </span>
                <span className="session-option-text">
                  <span className="session-option-name">
                    {session.name}
                    {session.unread ? <span className="pill">{session.unread}</span> : null}
                  </span>
                  <span className="session-option-accounts">
                    {accounts.length ? accounts.map((item) => item.email).join(" · ") : "No accounts yet"}
                  </span>
                </span>
                {index < 9 ? <Kbd>Ctrl {index + 1}</Kbd> : null}
                {active ? <Check size={16} className="menu-check" /> : null}
              </button>
            );
          })}
          <MenuDivider />
          <MenuItem icon={UserPlus} label="Add an account" onClick={() => { close(); openSettings("accounts"); }} />
          <MenuItem icon={Plus} label="New session" onClick={() => { close(); openSettings("sessions"); }} />
          <MenuItem icon={SlidersHorizontal} label="Manage sessions" onClick={() => { close(); openSettings("sessions"); }} />
        </>
      )}
    </Popover>
  );
}

export function SearchBar() {
  const { query, setQuery, searchAll, setSearchAll, activeSession, mailboxTitle } = useMail();
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const wrap = useDismiss<HTMLDivElement>(focused, () => setFocused(false));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as Element | null;
      const typing = Boolean(target?.closest("input, textarea, select, [contenteditable='true']"));
      if (!typing && event.key === "/") {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const last = query.split(/\s+/).pop() ?? "";
  const hints = SEARCH_HINTS.filter((item) => !last || item.token.startsWith(last.toLowerCase())).slice(0, 8);

  const insert = (token: string) => {
    const parts = query.split(/\s+/);
    if (last && token.startsWith(last.toLowerCase())) parts.pop();
    const next = [...parts.filter(Boolean), token].join(" ") + (token.endsWith(":") ? "" : " ");
    setQuery(next);
    input.current?.focus();
  };

  return (
    <div className={`search${focused ? " focused" : ""}`} ref={wrap}>
      <Search size={17} className="search-icon" />
      <input
        ref={input}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => setFocused(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            if (query) setQuery("");
            else input.current?.blur();
            setFocused(false);
          }
          if (event.key === "Enter") setFocused(false);
        }}
        placeholder={`Search ${activeSession?.name ?? ""} mail`}
        aria-label="Search mail"
        spellCheck={false}
      />
      {query ? (
        <button type="button" className="search-clear" onClick={() => setQuery("")} aria-label="Clear search">
          <X size={15} />
        </button>
      ) : (
        <Kbd>/</Kbd>
      )}
      {focused ? (
        <div className="search-pop">
          <div className="search-scope">
            <span>Search in</span>
            <button type="button" className={searchAll ? "on" : ""} onClick={() => setSearchAll(true)}>
              All folders
            </button>
            <button type="button" className={!searchAll ? "on" : ""} onClick={() => setSearchAll(false)}>
              {mailboxTitle === "Search results" ? "Current folder" : mailboxTitle}
            </button>
          </div>
          <div className="menu-title">Search operators</div>
          <div className="search-hints">
            {hints.map((item) => (
              <button key={item.token} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => insert(item.token)}>
                <code>{item.token}</code>
                <span>{item.hint}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function Topbar() {
  const { boot, saveSettings, syncNow, syncing, openSettings, setHelpOpen, setPaletteOpen } = useMail();
  const dark = document.documentElement.dataset.theme === "dark";
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden>
          <svg viewBox="0 0 32 32" width="18" height="18">
            <path d="M5 9.5 16 17l11-7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            <rect x="4" y="7" width="24" height="18" rx="4.5" fill="none" stroke="currentColor" strokeWidth="2.6" />
          </svg>
        </span>
        <span className="brand-word">Poso</span>
      </div>
      <SessionMenu />
      <SearchBar />
      <div className="topbar-actions">
        <IconButton icon={Command} label="Command palette" kbd="Ctrl+K" onClick={() => setPaletteOpen(true)} />
        <IconButton icon={RefreshCw} label="Check for new mail" onClick={() => void syncNow()} className={syncing ? "spinning" : ""} />
        <IconButton
          icon={dark ? Sun : Moon}
          label={dark ? "Light theme" : "Dark theme"}
          onClick={() => void saveSettings({ theme: dark ? "light" : "dark" })}
        />
        <IconButton icon={CircleHelp} label="Keyboard shortcuts" kbd="?" onClick={() => setHelpOpen(true)} />
        <IconButton icon={SettingsIcon} label="Settings" onClick={() => openSettings("general")} />
        {boot ? <span className="topbar-sep" /> : null}
      </div>
    </header>
  );
}
