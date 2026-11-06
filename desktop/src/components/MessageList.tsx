import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlarmClock,
  Archive,
  ArchiveRestore,
  CheckCheck,
  Clock3,
  FileText,
  Flag,
  Inbox,
  ListTree,
  Mail,
  MailOpen,
  Paperclip,
  Pencil,
  Pin,
  SearchX,
  ShieldAlert,
  ShieldCheck,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { formatWhen, relative } from "../format";
import { useMail } from "../state";
import type { Message, QuickFilter } from "../types";
import { Avatar, Empty, IconButton, LabelChip } from "./ui";
import { LabelMenu, SnoozeMenu } from "./Menus";

const FILTERS: { value: QuickFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "flagged", label: "Flagged" },
  { value: "attachments", label: "Attachments" },
];

function BulkBar() {
  const { checked, setChecked, rows, act, mailbox } = useMail();
  const role = mailbox.kind === "role" ? mailbox.role : "";
  const ids = [...checked];
  const allUnread = rows.filter((row) => checked.has(row.id)).some((row) => row.threadUnread);
  return (
    <div className="bulk-bar">
      <IconButton icon={X} label="Clear selection" onClick={() => setChecked(new Set())} size={16} />
      <span className="bulk-count">{checked.size} selected</span>
      <span className="bulk-sep" />
      {role === "archive" || role === "trash" || role === "spam" ? (
        <IconButton icon={ArchiveRestore} label="Move to Inbox" onClick={() => void act(role === "spam" ? "not_spam" : "inbox", ids)} size={17} />
      ) : (
        <IconButton icon={Archive} label="Archive" kbd="E" onClick={() => void act("archive", ids)} size={17} />
      )}
      {role === "trash" ? (
        <IconButton icon={Trash2} label="Delete forever" onClick={() => void act("delete_forever", ids)} size={17} className="danger" />
      ) : (
        <IconButton icon={Trash2} label="Delete" kbd="#" onClick={() => void act("trash", ids)} size={17} />
      )}
      {role !== "spam" ? <IconButton icon={ShieldAlert} label="Report spam" kbd="!" onClick={() => void act("spam", ids)} size={17} /> : null}
      <IconButton
        icon={allUnread ? MailOpen : Mail}
        label={allUnread ? "Mark as read" : "Mark as unread"}
        onClick={() => void act(allUnread ? "read" : "unread", ids)}
        size={17}
      />
      <IconButton icon={Flag} label="Flag" onClick={() => void act("flag", ids)} size={17} />
      <SnoozeMenu ids={ids} />
      <LabelMenu ids={ids} />
    </div>
  );
}

function Row({ message, style, compact }: { message: Message; style: React.CSSProperties; compact: boolean }) {
  const { selectedId, select, checked, toggleCheck, act, sessionLabels, mailbox, sessionAccounts } = useMail();
  const selected = message.id === selectedId || Boolean(selectedId && message.threadIds?.includes(selectedId));
  const isChecked = checked.has(message.id);
  const unread = message.threadUnread ?? !message.seen;
  const role = mailbox.kind === "role" ? mailbox.role : "";
  const sent = message.folder_role === "sent" || message.folder_role === "drafts";
  const who = sent ? `To: ${message.to.map((item) => item.name || item.email).join(", ") || "(no recipient)"}` : message.from_name || message.from_email || "(unknown sender)";
  const labels = message.labels.map((id) => sessionLabels.find((label) => label.id === id)).filter(Boolean);
  const multiAccount = sessionAccounts.length > 1;
  const classes = ["msg-row", unread ? "unread" : "", selected ? "selected" : "", isChecked ? "checked" : "", compact ? "compact" : ""].filter(Boolean).join(" ");

  return (
    <div
      className={classes}
      style={{ ...style, ["--acct" as string]: message.account_color }}
      role="option"
      aria-selected={selected}
      onClick={(event) => {
        if (event.ctrlKey || event.metaKey) toggleCheck(message.id);
        else select(message.id);
      }}
    >
      {multiAccount ? <span className="acct-bar" title={message.account_email} /> : null}
      <div
        className="row-lead"
        onClick={(event) => {
          event.stopPropagation();
          toggleCheck(message.id);
        }}
      >
        <span className="row-avatar">
          <Avatar name={sent ? message.to[0]?.name || "" : message.from_name} email={sent ? message.to[0]?.email || "" : message.from_email} size={compact ? 26 : 36} />
        </span>
        <span className="row-check" role="checkbox" aria-checked={isChecked} aria-label="Select">
          <CheckCheck size={14} />
        </span>
      </div>
      <div className="row-body">
        <div className="row-line">
          <span className="row-from">{who}</span>
          {message.threadCount && message.threadCount > 1 ? <span className="row-count">{message.threadCount}</span> : null}
          {compact ? (
            <span className="row-subject-inline">
              <b>{message.subject}</b> <span className="row-snippet">— {message.snippet}</span>
            </span>
          ) : null}
          <span className="row-meta">
            {message.pinned ? <Pin size={13} className="meta-pin" /> : null}
            {message.has_attachments ? <Paperclip size={13} /> : null}
            {message.flagged ? <Flag size={13} className="meta-flag" /> : null}
            {role === "snoozed" && message.snoozed_until ? (
              <span className="row-snooze">
                <AlarmClock size={12} /> {relative(message.snoozed_until)}
              </span>
            ) : (
              <span className="row-when">{formatWhen(message.date)}</span>
            )}
          </span>
          <span className="row-hover" onClick={(event) => event.stopPropagation()}>
            {role === "spam" ? (
              <IconButton icon={ShieldCheck} label="Not spam" onClick={() => void act("not_spam", [message.id])} size={16} />
            ) : role === "archive" || role === "trash" ? (
              <IconButton icon={Inbox} label="Move to Inbox" onClick={() => void act("inbox", [message.id])} size={16} />
            ) : (
              <IconButton icon={Archive} label="Archive" onClick={() => void act("archive", [message.id])} size={16} />
            )}
            {role === "trash" ? (
              <IconButton icon={Trash2} label="Delete forever" onClick={() => void act("delete_forever", [message.id])} size={16} />
            ) : (
              <IconButton icon={Trash2} label="Delete" onClick={() => void act("trash", [message.id])} size={16} />
            )}
            <IconButton
              icon={unread ? MailOpen : Mail}
              label={unread ? "Mark as read" : "Mark as unread"}
              onClick={() => void act(unread ? "read" : "unread", [message.id])}
              size={16}
            />
            <IconButton icon={Flag} label={message.flagged ? "Unflag" : "Flag"} active={message.flagged} onClick={() => void act(message.flagged ? "unflag" : "flag", [message.id])} size={16} />
          </span>
        </div>
        {compact ? null : (
          <>
            <div className="row-subject">
              {message.subject}
              {labels.map((label) => (label ? <LabelChip key={label.id} name={label.name} color={label.color} /> : null))}
            </div>
            <div className="row-snippet">{message.snippet || " "}</div>
          </>
        )}
      </div>
    </div>
  );
}

function DraftsView() {
  const { drafts, openDraft } = useMail();
  if (!drafts.length) return <Empty icon={FileText} title="No drafts" body="Messages you start and don't send are saved here automatically." />;
  return (
    <div className="list-scroll">
      {drafts.map((draft) => (
        <div key={draft.id} className="msg-row" onClick={() => openDraft(draft)} role="option" aria-selected={false}>
          <div className="row-lead">
            <span className="row-avatar draft-icon">
              <Pencil size={15} />
            </span>
          </div>
          <div className="row-body">
            <div className="row-line">
              <span className="row-from draft-to">{draft.to ? `To: ${draft.to}` : "(no recipient)"}</span>
              <span className="row-meta">
                <span className="row-when">{formatWhen(draft.updated_at)}</span>
              </span>
            </div>
            <div className="row-subject">{draft.subject || "(no subject)"}</div>
            <div className="row-snippet">
              <span className="draft-tag">Draft</span> {draft.account_email}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ScheduledView() {
  const { outbox, editScheduled } = useMail();
  if (!outbox.length) return <Empty icon={Clock3} title="Nothing scheduled" body="Use the arrow next to Send to pick a delivery time." />;
  return (
    <div className="list-scroll">
      {outbox.map((item) => (
        <div key={item.id} className="msg-row" role="option" aria-selected={false}>
          <div className="row-lead">
            <span className="row-avatar draft-icon">
              <Clock3 size={15} />
            </span>
          </div>
          <div className="row-body">
            <div className="row-line">
              <span className="row-from">To: {item.to}</span>
              <span className="row-meta">
                <span className={`row-when${item.status === "failed" ? " failed" : ""}`}>
                  {item.status === "failed" ? "Failed" : relative(item.send_at)}
                </span>
              </span>
            </div>
            <div className="row-subject">{item.subject || "(no subject)"}</div>
            <div className="row-snippet">
              {item.error ? <span className="error-text">{item.error}</span> : `Sends ${item.send_at ? new Date(item.send_at).toLocaleString() : ""} from ${item.account_email}`}
            </div>
            <div className="row-actions">
              <button type="button" className="btn sm" onClick={() => void editScheduled(item)}>
                Edit or cancel
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function MessageList() {
  const { rows, total, messages, loadMore, mailbox, mailboxTitle, quick, setQuick, checked, setChecked, boot, saveSettings, emptyFolder, query, listLoading } = useMail();
  const parentRef = useRef<HTMLDivElement>(null);
  const compact = boot?.settings.density === "compact";
  const rowHeight = compact ? 46 : 88;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
  });
  const role = mailbox.kind === "role" ? mailbox.role : "";
  const special = !query.trim() && (role === "drafts" || role === "scheduled");
  const allChecked = rows.length > 0 && rows.every((row) => checked.has(row.id));

  return (
    <section className="list-pane" aria-label="Messages">
      <div className="list-head">
        <div className="list-title">
          <h1>{mailboxTitle}</h1>
          {!special ? (
            <span className="list-total">
              {total.toLocaleString()} {total === 1 ? "message" : "messages"}
            </span>
          ) : null}
          <span className="grow" />
          {(role === "trash" || role === "spam") && rows.length > 0 ? (
            <button type="button" className="btn sm danger-ghost" onClick={() => void emptyFolder(role)}>
              Empty {role === "trash" ? "Trash" : "Spam"}
            </button>
          ) : null}
          {!special ? (
            <IconButton
              icon={ListTree}
              label={boot?.settings.conversations ? "Conversation view on" : "Conversation view off"}
              active={boot?.settings.conversations}
              onClick={() => void saveSettings({ conversations: !boot?.settings.conversations })}
              size={17}
            />
          ) : null}
        </div>
        {special ? null : checked.size ? (
          <BulkBar />
        ) : (
          <div className="list-tools">
            <button
              type="button"
              className={`select-all${allChecked ? " on" : ""}`}
              aria-label="Select all"
              onClick={() => setChecked(allChecked ? new Set() : new Set(rows.map((row) => row.id)))}
            >
              <CheckCheck size={14} />
            </button>
            <div className="chips">
              {FILTERS.map((item) => (
                <button key={item.value} type="button" className={`chip${quick === item.value ? " on" : ""}`} onClick={() => setQuick(item.value)}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {role === "spam" && !special ? (
          <div className="info-strip">
            <ShieldAlert size={15} />
            <span>Spam from every account in this session. “Not spam” trains the filter and allowlists the sender.</span>
          </div>
        ) : null}
      </div>
      {role === "drafts" && !query.trim() ? (
        <DraftsView />
      ) : role === "scheduled" && !query.trim() ? (
        <ScheduledView />
      ) : rows.length === 0 ? (
        listLoading ? (
          <div className="list-skeleton">
            {Array.from({ length: 7 }).map((_, index) => (
              <div key={index} className="skeleton-row">
                <span className="sk-avatar" />
                <span className="sk-lines">
                  <span />
                  <span />
                </span>
              </div>
            ))}
          </div>
        ) : query.trim() ? (
          <Empty icon={SearchX} title="No matches" body="Try fewer words, or operators like from:, has:attachment, label:." />
        ) : (
          <Empty
            icon={role === "spam" ? ShieldCheck : role === "snoozed" ? AlarmClock : role === "flagged" ? Flag : mailbox.kind === "label" ? Tag : Inbox}
            title={role === "inbox" && quick === "all" ? "You're all caught up" : "Nothing here"}
            body={role === "inbox" && quick === "all" ? "New mail for this session lands here." : "Messages will show up here when there are some."}
          />
        )
      ) : (
        <div className="list-scroll" ref={parentRef} role="listbox" aria-label={mailboxTitle} aria-multiselectable>
          <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const message = rows[item.index];
              return (
                <Row
                  key={message.id}
                  message={message}
                  compact={compact}
                  style={{ position: "absolute", top: 0, left: 0, width: "100%", height: rowHeight, transform: `translateY(${item.start}px)` }}
                />
              );
            })}
          </div>
          {total > messages.length ? (
            <div className="load-more">
              <button type="button" className="btn sm" onClick={loadMore}>
                Load more ({(total - messages.length).toLocaleString()} left)
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
