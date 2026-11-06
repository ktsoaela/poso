import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { formatWhen } from "../format";
import { useMail } from "../state";

export function SpamQueue() {
  const { rows, selectedId, select, notSpam, moveMessage } = useMail();
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 118,
    overscan: 6,
  });

  return (
    <section className="list-pane" aria-label="Spam">
      <div className="list-head">
        <div className="list-title">
          <h1>Spam</h1>
        </div>
        <p className="lede">Junk from every account in this session. Not spam teaches the filter and allowlists the sender.</p>
      </div>
      {rows.length === 0 ? (
        <div className="empty">
          <div>
            <h2>Spam is clear</h2>
            <p className="lede">Reported mail and high-scoring mail land here.</p>
          </div>
        </div>
      ) : (
        <div className="spam-scroll" ref={parentRef}>
          <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const message = rows[item.index];
              return (
                <div
                  key={message.id}
                  className={message.id === selectedId ? "row selected" : "row"}
                  style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${item.start}px)` }}
                >
                  <span className="dot" style={{ background: message.account_color }} />
                  <span className="row-main">
                    <button className="text-btn" onClick={() => select(message.id)}>
                      <span className="row-top">
                        <span className="from">{message.from_name || message.from_email}</span>
                        <span className="when">{formatWhen(message.date)}</span>
                      </span>
                      <span className="subject">{message.subject}</span>
                    </button>
                    <span className="row-actions">
                      <button className="text-btn" onClick={() => void notSpam(message.id)}>
                        Not spam
                      </button>
                      <button className="text-btn" onClick={() => void moveMessage(message.id, "trash")}>
                        Delete
                      </button>
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
