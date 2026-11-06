import { useEffect, useMemo, useState } from "react";
import { useMail } from "../state";

export function CommandPalette() {
  const {
    paletteOpen,
    setPaletteOpen,
    boot,
    sessionAccounts,
    switchSession,
    setMailbox,
    openCompose,
    setSettingsOpen,
  } = useMail();
  const [filter, setFilter] = useState("");
  const [cursor, setCursor] = useState(0);

  const items = useMemo(() => {
    if (!boot) return [];
    return [
      ...boot.sessions.map((session) => ({
        id: `session-${session.id}`,
        label: `Switch to ${session.name}`,
        run: () => void switchSession(session.id),
      })),
      { id: "inbox", label: "Go to Inbox", run: () => setMailbox({ kind: "role", role: "inbox" }) },
      { id: "spam", label: "Go to Spam", run: () => setMailbox({ kind: "role", role: "spam" }) },
      { id: "sent", label: "Go to Sent", run: () => setMailbox({ kind: "role", role: "sent" }) },
      { id: "compose", label: "New message", run: () => openCompose() },
      { id: "settings", label: "Settings", run: () => setSettingsOpen(true) },
      ...sessionAccounts.map((account) => ({
        id: `account-${account.id}`,
        label: `Mail for ${account.email}`,
        run: () => setMailbox({ kind: "role", role: "inbox", accountId: account.id }),
      })),
    ];
  }, [boot, sessionAccounts, switchSession, setMailbox, openCompose, setSettingsOpen]);

  const visible = items.filter((item) => item.label.toLowerCase().includes(filter.trim().toLowerCase()));

  useEffect(() => {
    setCursor(0);
  }, [filter, paletteOpen]);

  if (!paletteOpen) return null;

  return (
    <div className="overlay" onMouseDown={() => setPaletteOpen(false)}>
      <div
        className="sheet palette"
        role="dialog"
        aria-label="Command palette"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          placeholder="Jump to a session, folder, or action"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setCursor((value) => Math.min(visible.length - 1, value + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setCursor((value) => Math.max(0, value - 1));
            } else if (event.key === "Enter" && visible[cursor]) {
              event.preventDefault();
              visible[cursor].run();
              setPaletteOpen(false);
              setFilter("");
            }
          }}
        />
        {visible.map((item, index) => (
          <button
            key={item.id}
            className={index === cursor ? "active" : ""}
            onMouseEnter={() => setCursor(index)}
            onClick={() => {
              item.run();
              setPaletteOpen(false);
              setFilter("");
            }}
          >
            {item.label}
          </button>
        ))}
        <p className="hint">J K move · C compose · R reply · E archive · # delete</p>
      </div>
    </div>
  );
}
