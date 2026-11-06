import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { formatWhen } from "../format";
import { useMail } from "../state";
import type { Message } from "../types";

export function MessageList() {
  const { rows, selectedId, select, query, setQuery, conversations, setConversations, syncing, mailbox, drafts, openDraft } = useMail();
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 88,
    overscan: 8,
  });
  const title = mailbox.kind === "folder" ? "Folder" : mailbox.role[0].toUpperCase() + mailbox.role.slice(1);
  const showDrafts = mailbox.kind === "role" && mailbox.role === "drafts";

  return (
    <section className="list-pane" aria-label="Messages">
      <div className="list-head">
        <div className="list-title">
          <h1>{title}</h1>
          {syncing ? <span className="sync">Syncing</span> : null}
        </div>
        <label className="sr-only" htmlFor="search">
          Search this session
        </label>
        <input
          id="search"
          className="search"
          placeholder="Search this session"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="list-tools">
          <button className="icon-toggle" aria-pressed={conversations} onClick={() => setConversations(!conversations)}>
            {conversations ? "Conversations" : "Flat list"}
          </button>
        </div>
      </div>
      {showDrafts ? (
        <div className="list-scroll">
          {drafts.length === 0 ? <p className="hint">No drafts in this session.</p> : null}
          {drafts.map((draft) => (
            <button key={draft.id} className="row" onClick={() => openDraft(draft)}>
              <span className="dot" />
              <span className="row-main">
                <span className="row-top">
                  <span className="from">{draft.to || "(no recipient)"}</span>
                </span>
                <span className="subject">{draft.subject || "(no subject)"}</span>
                <span className="snippet">{draft.body}</span>
              </span>
            </button>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="empty">
          <div>
            <h2>Nothing here</h2>
            <p className="lede">New mail in this session will show up in this list.</p>
          </div>
        </div>
      ) : (
        <div className="list-scroll" ref={parentRef}>
          <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const message = rows[item.index] as Message;
              return (
                <button
                  key={message.id}
                  className={["row", message.seen ? "" : "unread", message.id === selectedId ? "selected" : ""].filter(Boolean).join(" ")}
                  style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${item.start}px)` }}
                  onClick={() => select(message.id)}
                >
                  <span className="dot" style={{ background: message.account_color }} />
                  <span className="row-main">
                    <span className="row-top">
                      <span className="from">{message.from_name || message.from_email || "(unknown)"}</span>
                      <span className="when">{formatWhen(message.date)}</span>
                    </span>
                    <span className="subject-line">
                      <span className="subject">{message.subject}</span>
                      {message.threadCount && message.threadCount > 1 ? <span className="badge">{message.threadCount}</span> : null}
                    </span>
                    <span className="snippet">{message.snippet}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
