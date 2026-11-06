import { useMail } from "../state";

export function SessionSwitcher() {
  const { boot, switchSession } = useMail();
  if (!boot) return null;
  return (
    <div className="session-switch" role="tablist" aria-label="Sessions">
      {boot.sessions.map((session, index) => (
        <button
          key={session.id}
          className={session.id === boot.active_session_id ? "session-btn active" : "session-btn"}
          style={{ ["--session" as string]: session.color }}
          role="tab"
          aria-selected={session.id === boot.active_session_id}
          onClick={() => void switchSession(session.id)}
        >
          <span>
            <strong>{session.name}</strong>
            <span>{index < 9 ? `Ctrl+${index + 1}` : "Session"}</span>
          </span>
          {session.unread > 0 ? <span className="count">{session.unread}</span> : null}
        </button>
      ))}
    </div>
  );
}
