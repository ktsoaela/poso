import { downloadFile } from "../api";
import { formatFull, people, prepareHtml } from "../format";
import { useMail } from "../state";

export function Reader() {
  const { detail, loadImages, setLoadImages, reply, forward, archive, trash, reportSpam, toggleFlag } = useMail();
  if (!detail) {
    return (
      <section className="reader">
        <div className="empty">
          <div>
            <h2>Choose a message</h2>
            <p className="lede">The reading pane keeps a short line length, and remote images stay off until you ask.</p>
          </div>
        </div>
      </section>
    );
  }
  const html = detail.body_html ? prepareHtml(detail.body_html, loadImages) : "";
  const remoteBlocked = Boolean(detail.body_html && !loadImages && /<img\b/i.test(detail.body_html));
  const initial = (detail.from_name || detail.from_email || "?").slice(0, 1).toUpperCase();

  return (
    <section className="reader" aria-label="Reading pane">
      <div className="reader-scroll">
        <article className="letter">
          <div className="reader-actions">
            <button className="text-btn" onClick={() => reply(false)}>Reply</button>
            <button className="text-btn" onClick={() => reply(true)}>Reply all</button>
            <button className="text-btn" onClick={forward}>Forward</button>
            <button className="text-btn" onClick={() => void archive()}>Archive</button>
            <button className="text-btn" onClick={() => void reportSpam()}>Spam</button>
            <button className="text-btn" onClick={() => void trash()}>Delete</button>
            <button className="icon-toggle" aria-pressed={detail.flagged} onClick={() => void toggleFlag()}>
              {detail.flagged ? "Flagged" : "Flag"}
            </button>
          </div>
          <h2>{detail.subject}</h2>
          <div className="who">
            <span className="avatar" style={{ color: detail.account_color }}>{initial}</span>
            <div>
              <strong>{detail.from_name || detail.from_email || "Unknown sender"}</strong>
              <div className="meta">
                {detail.from_email} · to {people(detail.to) || detail.account_email} · {formatFull(detail.date)}
              </div>
              <div className="meta">Received by {detail.account_email}</div>
            </div>
          </div>
          {detail.spam_score != null && detail.spam_score >= 0.6 && detail.folder_role === "inbox" ? (
            <div className="banner">
              <span>This looks like spam ({Math.round(detail.spam_score * 100)}%).</span>
              <button className="text-btn" onClick={() => void reportSpam()}>Move to spam</button>
            </div>
          ) : null}
          {remoteBlocked ? (
            <div className="banner">
              <span>Remote images are blocked.</span>
              <button className="text-btn" onClick={() => setLoadImages(true)}>Load images</button>
            </div>
          ) : null}
          {detail.attachments.length > 0 ? (
            <div className="attachments">
              {detail.attachments.map((item) => (
                <button
                  key={item.id}
                  className="chip"
                  onClick={() => void downloadFile(`/api/messages/${detail.id}/attachments/${item.id}`, item.filename)}
                >
                  {item.filename}
                </button>
              ))}
            </div>
          ) : null}
          {html ? (
            <div className="reader-html" dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <p className="plain">{detail.body_text || detail.snippet}</p>
          )}
          {detail.thread.length > 1 ? (
            <div className="thread">
              {detail.thread.map((item) => (
                <p key={item.id} className="meta">
                  {item.from_name || item.from_email}: {item.subject}
                </p>
              ))}
            </div>
          ) : null}
        </article>
      </div>
    </section>
  );
}
