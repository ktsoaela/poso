import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowLeft,
  ChevronDown,
  Download,
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  Flag,
  Forward,
  ImageOff,
  Inbox,
  Mail,
  MailOpen,
  MoreHorizontal,
  Pin,
  PinOff,
  Printer,
  Reply,
  ReplyAll,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Type,
} from "lucide-react";
import { downloadFile, openExternal } from "../api";
import { buildSrcdoc, formatBytes, formatFull, hasRemoteContent, people, printMessage, relative } from "../format";
import { useMail } from "../state";
import type { Attachment, MessageDetail } from "../types";
import { Avatar, Empty, IconButton, LabelChip, MenuItem, Popover } from "./ui";
import { LabelMenu, MoveMenu, SnoozeMenu } from "./Menus";

export function MailFrame({ html, text, allowRemote }: { html: string; text: string; allowRemote: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const srcdoc = useMemo(() => buildSrcdoc(html, text, allowRemote), [html, text, allowRemote]);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let observer: ResizeObserver | null = null;
    const onLoad = () => {
      const doc = frame.contentDocument;
      if (!doc) return;
      const measure = () => setHeight(Math.max(60, Math.ceil(doc.documentElement.scrollHeight)));
      measure();
      observer = new ResizeObserver(measure);
      observer.observe(doc.body);
      doc.querySelectorAll("img").forEach((img) => img.addEventListener("load", measure));
      doc.addEventListener("click", (event) => {
        const anchor = (event.target as Element | null)?.closest("a");
        const href = anchor?.getAttribute("href") || "";
        if (!anchor || href.startsWith("#")) return;
        event.preventDefault();
        void openExternal(href);
      });
    };
    frame.addEventListener("load", onLoad);
    return () => {
      frame.removeEventListener("load", onLoad);
      observer?.disconnect();
    };
  }, [srcdoc]);

  return (
    <iframe
      ref={ref}
      className="mail-frame"
      title="Message body"
      sandbox="allow-same-origin"
      srcDoc={srcdoc}
      style={{ height }}
      referrerPolicy="no-referrer"
    />
  );
}

function fileIcon(item: Attachment) {
  const type = item.content_type;
  if (type.startsWith("image/")) return FileImage;
  if (type.includes("sheet") || type.includes("csv") || type.includes("excel")) return FileSpreadsheet;
  if (type.includes("zip") || type.includes("compressed")) return FileArchive;
  if (type.startsWith("text/") || type.includes("pdf") || type.includes("word")) return FileText;
  return File;
}

function Attachments({ detail }: { detail: MessageDetail }) {
  const { toast } = useMail();
  if (!detail.attachments.length) return null;
  const totalSize = detail.attachments.reduce((sum, item) => sum + item.size, 0);
  return (
    <div className="attachments">
      <div className="attachments-head">
        {detail.attachments.length} attachment{detail.attachments.length === 1 ? "" : "s"} · {formatBytes(totalSize)}
      </div>
      <div className="attachment-grid">
        {detail.attachments.map((item) => {
          const Icon = fileIcon(item);
          return (
            <button
              key={item.id}
              type="button"
              className="attachment"
              onClick={() =>
                void downloadFile(`/api/messages/${detail.id}/attachments/${item.id}`, item.filename)
                  .then((name) => toast(`Downloaded ${name}`))
                  .catch((err: Error) => toast(err.message, { tone: "error" }))
              }
            >
              <span className="attachment-icon">
                <Icon size={20} />
              </span>
              <span className="attachment-text">
                <span className="attachment-name">{item.filename}</span>
                <span className="attachment-size">{formatBytes(item.size)}</span>
              </span>
              <Download size={15} className="attachment-dl" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Toolbar({ detail, onBack }: { detail: MessageDetail; onBack?: () => void }) {
  const { reply, forward, act, pinMessage, toast, mailbox } = useMail();
  const role = detail.folder_role;
  const view = mailbox.kind === "role" ? mailbox.role : role;
  return (
    <div className="reader-toolbar">
      {onBack ? <IconButton icon={ArrowLeft} label="Back to list" onClick={onBack} /> : null}
      <div className="tool-group">
        <button type="button" className="btn sm primary-soft" onClick={() => reply(false)} title="Reply (R)">
          <Reply size={16} /> Reply
        </button>
        <IconButton icon={ReplyAll} label="Reply all" kbd="A" onClick={() => reply(true)} size={17} />
        <IconButton icon={Forward} label="Forward" kbd="F" onClick={forward} size={17} />
      </div>
      <span className="tool-sep" />
      <div className="tool-group">
        {role === "archive" || role === "trash" ? (
          <IconButton icon={Inbox} label="Move to Inbox" onClick={() => void act("inbox")} size={17} />
        ) : (
          <IconButton icon={Archive} label="Archive" kbd="E" onClick={() => void act("archive")} size={17} />
        )}
        {role === "trash" ? (
          <IconButton icon={Trash2} label="Delete forever" onClick={() => void act("delete_forever")} size={17} className="danger" />
        ) : (
          <IconButton icon={Trash2} label="Delete" kbd="#" onClick={() => void act("trash")} size={17} />
        )}
        {role === "spam" ? (
          <IconButton icon={ShieldCheck} label="Not spam" onClick={() => void act("not_spam")} size={17} />
        ) : (
          <IconButton icon={ShieldAlert} label="Report spam" kbd="!" onClick={() => void act("spam")} size={17} />
        )}
        <MoveMenu role={role} />
      </div>
      <span className="tool-sep" />
      <div className="tool-group">
        <IconButton icon={detail.seen ? Mail : MailOpen} label={detail.seen ? "Mark as unread" : "Mark as read"} kbd="Shift+U" onClick={() => void act(detail.seen ? "unread" : "read", [detail.id])} size={17} />
        <IconButton icon={Flag} label={detail.flagged ? "Unflag" : "Flag"} kbd="S" active={detail.flagged} onClick={() => void act(detail.flagged ? "unflag" : "flag", [detail.id])} size={17} />
        <SnoozeMenu snoozed={view === "snoozed" || Boolean(detail.snoozed_until)} />
        <LabelMenu current={detail.labels} />
      </div>
      <span className="grow" />
      <Popover
        align="right"
        trigger={({ toggle, open }) => <IconButton icon={MoreHorizontal} label="More" onClick={toggle} active={open} />}
      >
        {(close) => (
          <>
            <MenuItem
              icon={detail.pinned ? PinOff : Pin}
              label={detail.pinned ? "Unpin from top" : "Pin to top of inbox"}
              onClick={() => {
                close();
                void pinMessage(detail.id, !detail.pinned);
              }}
            />
            <MenuItem
              icon={Printer}
              label="Print"
              hint="Ctrl+P"
              onClick={() => {
                close();
                printMessage(detail);
              }}
            />
            <MenuItem
              icon={Download}
              label="Download as .eml"
              onClick={() => {
                close();
                void downloadFile(`/api/messages/${detail.id}/eml`, "message.eml")
                  .then((name) => toast(`Saved ${name}`))
                  .catch((err: Error) => toast(err.message, { tone: "error" }));
              }}
            />
          </>
        )}
      </Popover>
    </div>
  );
}

function Collapsed({ id, name, email, snippet, date, onOpen }: { id: number; name: string; email: string; snippet: string; date: string | null; onOpen: (id: number) => void }) {
  return (
    <button type="button" className="thread-collapsed" onClick={() => onOpen(id)}>
      <Avatar name={name} email={email} size={30} />
      <span className="tc-name">{name || email}</span>
      <span className="tc-snippet">{snippet}</span>
      <span className="tc-date">{formatFull(date)}</span>
    </button>
  );
}

export function Reader({ onBack }: { onBack?: () => void }) {
  const { detail, detailLoading, remoteAllowed, allowRemote, sessionLabels, labelMessages, act, select, reply, forward, selectedId } = useMail();
  const [showDetails, setShowDetails] = useState(false);
  const [plain, setPlain] = useState(false);

  useEffect(() => {
    setShowDetails(false);
    setPlain(false);
  }, [detail?.id]);

  if (!detail || detail.id !== selectedId) {
    return (
      <section className="reader" aria-label="Reading pane">
        {detailLoading ? (
          <div className="reader-loading">
            <span className="spinner" />
          </div>
        ) : (
          <Empty icon={Mail} title="Select a message" body="Pick a conversation to read it here. Remote images stay blocked until you allow them." />
        )}
      </section>
    );
  }

  const html = plain ? "" : detail.body_html;
  const allowed = remoteAllowed(detail.id);
  const blocked = Boolean(html && !allowed && hasRemoteContent(html));
  const labels = detail.labels.map((id) => sessionLabels.find((item) => item.id === id)).filter(Boolean);
  const thread = detail.thread.length > 1 ? detail.thread : [];
  const before = thread.filter((item) => item.id !== detail.id && (item.date ?? "") <= (detail.date ?? ""));
  const after = thread.filter((item) => item.id !== detail.id && (item.date ?? "") > (detail.date ?? ""));

  return (
    <section className="reader" aria-label="Reading pane">
      <Toolbar detail={detail} onBack={onBack} />
      <div className="reader-scroll">
        <article className="letter">
          <header className="letter-head">
            <h2 className="letter-subject">{detail.subject}</h2>
            <div className="letter-tags">
              <span className="folder-pill">{detail.folder_role === "custom" ? detail.folder_name : detail.folder_role}</span>
              {labels.map((label) =>
                label ? <LabelChip key={label.id} name={label.name} color={label.color} onRemove={() => void labelMessages(label.id, false, [detail.id])} /> : null,
              )}
              {thread.length ? <span className="folder-pill soft">{thread.length} in conversation</span> : null}
            </div>
          </header>

          {before.map((item) => (
            <Collapsed key={item.id} id={item.id} name={item.from_name} email={item.from_email} snippet={item.snippet} date={item.date} onOpen={select} />
          ))}

          <div className="message-card">
            <div className="sender">
              <Avatar name={detail.from_name} email={detail.from_email} size={42} />
              <div className="sender-text">
                <div className="sender-line">
                  <strong>{detail.from_name || detail.from_email || "Unknown sender"}</strong>
                  {detail.from_name ? <span className="sender-email">&lt;{detail.from_email}&gt;</span> : null}
                </div>
                <button type="button" className="recipients" onClick={() => setShowDetails((value) => !value)}>
                  to {people(detail.to) || detail.account_email}
                  {detail.cc.length ? `, cc ${people(detail.cc)}` : ""}
                  <ChevronDown size={14} className={showDetails ? "flip" : ""} />
                </button>
                {showDetails ? (
                  <dl className="header-details">
                    <dt>From</dt>
                    <dd>{detail.from_name} &lt;{detail.from_email}&gt;</dd>
                    <dt>To</dt>
                    <dd>{detail.to.map((item) => `${item.name ? `${item.name} ` : ""}<${item.email}>`).join(", ") || "—"}</dd>
                    {detail.cc.length ? (
                      <>
                        <dt>Cc</dt>
                        <dd>{detail.cc.map((item) => item.email).join(", ")}</dd>
                      </>
                    ) : null}
                    <dt>Date</dt>
                    <dd>{formatFull(detail.date)}</dd>
                    <dt>Received by</dt>
                    <dd>
                      <span className="account-dot inline" style={{ background: detail.account_color }} /> {detail.account_email}
                    </dd>
                    <dt>Size</dt>
                    <dd>{detail.size ? formatBytes(detail.size) : "—"}</dd>
                    {detail.spam_score != null ? (
                      <>
                        <dt>Spam score</dt>
                        <dd>{Math.round(detail.spam_score * 100)}%</dd>
                      </>
                    ) : null}
                  </dl>
                ) : null}
              </div>
              <div className="sender-meta">
                <span title={formatFull(detail.date)}>{formatFull(detail.date)}</span>
                <span className="sender-ago">{relative(detail.date)}</span>
              </div>
            </div>

            {detail.spam_score != null && detail.spam_score >= 0.6 && detail.folder_role === "inbox" ? (
              <div className="banner warn">
                <ShieldAlert size={16} />
                <span>This looks like spam ({Math.round(detail.spam_score * 100)}% likely).</span>
                <button type="button" className="btn sm" onClick={() => void act("spam", [detail.id])}>
                  Move to spam
                </button>
              </div>
            ) : null}
            {detail.folder_role === "spam" ? (
              <div className="banner danger">
                <ShieldAlert size={16} />
                <span>{detail.auto_spam ? "Poso filed this as spam automatically." : "This message is in Spam."} Links and images are blocked.</span>
                <button type="button" className="btn sm" onClick={() => void act("not_spam", [detail.id])}>
                  Not spam
                </button>
              </div>
            ) : null}
            {blocked && detail.folder_role !== "spam" ? (
              <div className="banner">
                <ImageOff size={16} />
                <span>Remote images are blocked to protect your privacy.</span>
                <button type="button" className="btn sm" onClick={() => allowRemote(detail.id)}>
                  Load images
                </button>
              </div>
            ) : null}

            <div className="body-tools">
              {detail.body_html ? (
                <button type="button" className={`chip sm${plain ? " on" : ""}`} onClick={() => setPlain((value) => !value)}>
                  <Type size={13} /> {plain ? "Showing plain text" : "Plain text"}
                </button>
              ) : null}
            </div>

            <div className="paper">
              <MailFrame html={html} text={detail.body_text || detail.snippet} allowRemote={allowed && detail.folder_role !== "spam"} />
            </div>

            <Attachments detail={detail} />
          </div>

          {after.map((item) => (
            <Collapsed key={item.id} id={item.id} name={item.from_name} email={item.from_email} snippet={item.snippet} date={item.date} onOpen={select} />
          ))}

          <div className="reply-bar">
            <button type="button" className="btn" onClick={() => reply(false)}>
              <Reply size={16} /> Reply
            </button>
            <button type="button" className="btn" onClick={() => reply(true)}>
              <ReplyAll size={16} /> Reply all
            </button>
            <button type="button" className="btn" onClick={forward}>
              <Forward size={16} /> Forward
            </button>
          </div>
        </article>
      </div>
    </section>
  );
}
