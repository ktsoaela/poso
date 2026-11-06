import { Fragment, useEffect, useState } from "react";
import { ChevronDown, Download, RefreshCw, Search } from "lucide-react";
import { api, downloadFile } from "../../api";
import { useMail } from "../../state";
import type { AuditEvent } from "../../types";

const PAGE = 50;

function tone(action: string): string {
  if (action.includes("delete") || action.includes("remove") || action.includes("spam") || action.includes("failed")) return "red";
  if (action.startsWith("message.send") || action.startsWith("account.add") || action.startsWith("account.connect")) return "green";
  if (action.startsWith("data.") || action.startsWith("audit.")) return "blue";
  if (action.startsWith("rule.") || action.startsWith("settings.")) return "violet";
  return "gray";
}

function pretty(detail: string): string {
  if (!detail) return "";
  try {
    return JSON.stringify(JSON.parse(detail), null, 2);
  } catch {
    return detail;
  }
}

export function AuditTab() {
  const { boot, toast } = useMail();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [scope, setScope] = useState<"session" | "all">("session");
  const [since, setSince] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!boot) return;
    const params = new URLSearchParams({ limit: String(PAGE), offset: String(page * PAGE) });
    if (scope === "session") params.set("session_id", String(boot.active_session_id));
    if (action) params.set("action", action);
    if (q.trim()) params.set("q", q.trim());
    if (since) params.set("since", new Date(since).toISOString());
    const handle = window.setTimeout(() => {
      api<{ events: AuditEvent[]; total: number; actions: string[] }>(`/api/audit?${params}`)
        .then((data) => {
          setEvents(data.events);
          setTotal(data.total);
          setActions(data.actions);
        })
        .catch(() => setEvents([]));
    }, 180);
    return () => window.clearTimeout(handle);
  }, [boot, q, action, scope, since, page, refresh]);

  if (!boot) return null;
  const accountEmail = (id: number | null) => boot.accounts.find((item) => item.id === id)?.email ?? "";
  const sessionName = (id: number | null) => boot.sessions.find((item) => item.id === id)?.name ?? "—";
  const groups = [...new Set(actions.map((item) => item.split(".")[0]))];

  const exportLog = async (fmt: "csv" | "json") => {
    const params = new URLSearchParams({ fmt });
    if (scope === "session") params.set("session_id", String(boot.active_session_id));
    try {
      const name = await downloadFile(`/api/audit/export?${params}`, `audit.${fmt}`);
      toast(`Exported ${name}`, { tone: "success" });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Export failed.", { tone: "error" });
    }
  };

  return (
    <section className="set-section">
      <div className="set-section-head">
        <h3>Audit log</h3>
        <p>Every change Session makes — sign-ins, sends, moves, deletes, spam decisions, rules, imports, exports, and settings — with who did it and when. Kept locally and never edited.</p>
      </div>
      <div className="audit-filters">
        <div className="audit-search">
          <Search size={15} />
          <input placeholder="Search subject, address, detail…" value={q} onChange={(event) => { setQ(event.target.value); setPage(0); }} />
        </div>
        <select className="select sm" value={action} onChange={(event) => { setAction(event.target.value); setPage(0); }}>
          <option value="">All events</option>
          {groups.map((group) => (
            <optgroup key={group} label={group}>
              <option value={`${group}.`}>All {group} events</option>
              {actions.filter((item) => item.startsWith(`${group}.`)).map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <select className="select sm" value={scope} onChange={(event) => { setScope(event.target.value as "session" | "all"); setPage(0); }}>
          <option value="session">This session</option>
          <option value="all">All sessions</option>
        </select>
        <input className="select sm" type="date" value={since} onChange={(event) => { setSince(event.target.value); setPage(0); }} aria-label="Since date" />
        <button type="button" className="icon-btn" aria-label="Refresh" onClick={() => setRefresh((value) => value + 1)}>
          <RefreshCw size={15} />
        </button>
        <span className="grow" />
        <button type="button" className="btn sm" onClick={() => void exportLog("csv")}>
          <Download size={14} /> CSV
        </button>
        <button type="button" className="btn sm" onClick={() => void exportLog("json")}>
          <Download size={14} /> JSON
        </button>
      </div>
      <div className="audit-table-wrap">
        <table className="audit-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Event</th>
              <th>Target</th>
              <th>Account</th>
              <th>Session</th>
              <th>By</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <Fragment key={event.id}>
                <tr className={open === event.id ? "open" : ""} onClick={() => setOpen(open === event.id ? null : event.id)}>
                  <td className="nowrap">{event.at ? new Date(event.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : ""}</td>
                  <td>
                    <span className={`audit-pill ${tone(event.action)}`}>{event.action}</span>
                  </td>
                  <td className="truncate">{event.target}</td>
                  <td className="truncate muted">{accountEmail(event.account_id)}</td>
                  <td className="muted">{sessionName(event.session_id)}</td>
                  <td className="muted">{event.actor}</td>
                  <td>{event.detail ? <ChevronDown size={14} className={open === event.id ? "flip" : ""} /> : null}</td>
                </tr>
                {open === event.id && event.detail ? (
                  <tr className="audit-detail">
                    <td colSpan={7}>
                      <pre>{pretty(event.detail)}</pre>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
        {!events.length ? <p className="set-hint pad">No events match.</p> : null}
      </div>
      <div className="pager">
        <span className="set-hint">
          {total ? `${page * PAGE + 1}–${Math.min(total, (page + 1) * PAGE)} of ${total.toLocaleString()}` : "0 events"}
        </span>
        <button type="button" className="btn sm" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>
          Newer
        </button>
        <button type="button" className="btn sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((value) => value + 1)}>
          Older
        </button>
      </div>
    </section>
  );
}
