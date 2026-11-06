import { useRef, useState } from "react";
import { ChevronDown, Clock3, Maximize2, Minimize2, Minus, MoreHorizontal, Paperclip, Send, Trash2, X, AlertTriangle, MailCheck } from "lucide-react";
import { formatBytes } from "../format";
import { useMail } from "../state";
import type { ComposeFile } from "../types";
import { RecipientInput } from "./RecipientInput";
import { RichEditor, type EditorHandle } from "./RichEditor";
import { TimePicker } from "./Menus";
import { IconButton, MenuItem, Popover } from "./ui";

async function readFiles(list: FileList): Promise<ComposeFile[]> {
  return Promise.all(
    [...list].map(
      (file) =>
        new Promise<ComposeFile>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = String(reader.result || "");
            resolve({ filename: file.name, content_type: file.type || "application/octet-stream", data_base64: result.split(",")[1] || "", size: file.size });
          };
          reader.onerror = () => reject(new Error("Couldn't read a file."));
          reader.readAsDataURL(file);
        }),
    ),
  );
}

export function Composer() {
  const { compose, updateCompose, closeCompose, discardCompose, send, sending, sessionAccounts, toast } = useMail();
  const editor = useRef<EditorHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  if (!compose) return null;
  const draft = compose;
  const account = sessionAccounts.find((item) => item.id === draft.accountId);
  const total = draft.files.reduce((sum, file) => sum + file.size, 0);

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    try {
      const files = await readFiles(list);
      const next = [...draft.files, ...files];
      if (next.reduce((sum, file) => sum + file.size, 0) > 20 * 1024 * 1024) {
        toast("Attachments need to stay under 20 MB in total.", { tone: "error" });
        return;
      }
      updateCompose({ files: next });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't attach that file.", { tone: "error" });
    }
  };

  const switchAccount = (id: number) => {
    const next = sessionAccounts.find((item) => item.id === id);
    const el = editor.current?.element();
    if (el) {
      const block = el.querySelector("[data-signature]");
      if (next?.signature) {
        if (block) block.innerHTML = next.signature;
        else el.insertAdjacentHTML("beforeend", `<p><br></p><div data-signature="1">${next.signature}</div>`);
      } else if (block) {
        block.remove();
      }
      updateCompose({ accountId: id, html: el.innerHTML });
    } else {
      updateCompose({ accountId: id });
    }
  };

  const title = draft.subject.trim() || (draft.inReplyTo ? "Reply" : "New message");

  if (draft.minimized) {
    return (
      <div className="composer minimized">
        <button type="button" className="composer-title" onClick={() => updateCompose({ minimized: false })}>
          <span>{title}</span>
        </button>
        <IconButton icon={Maximize2} label="Restore" onClick={() => updateCompose({ minimized: false })} size={15} />
        <IconButton icon={X} label="Close (saved to drafts)" onClick={closeCompose} size={15} />
      </div>
    );
  }

  const body = (
    <form
      className={`composer${draft.expanded ? " expanded" : ""}${dragging ? " dragging" : ""}`}
      role="dialog"
      aria-label="Compose message"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(event) => {
        setDragging(false);
        if (event.dataTransfer.files.length && !(event.target as Element).closest(".rt-area")) {
          event.preventDefault();
          void addFiles(event.dataTransfer.files);
        }
      }}
    >
      <div className="composer-head">
        <span className="composer-title">{title}</span>
        <span className="grow" />
        <IconButton icon={Minus} label="Minimize" onClick={() => updateCompose({ minimized: true })} size={15} />
        <IconButton icon={draft.expanded ? Minimize2 : Maximize2} label={draft.expanded ? "Exit full size" : "Full size"} onClick={() => updateCompose({ expanded: !draft.expanded })} size={15} />
        <IconButton icon={X} label="Close (saved to drafts)" onClick={closeCompose} size={15} />
      </div>

      <div className="field-row">
        <span className="field-label">From</span>
        <span className="account-dot" style={{ background: account?.color }} />
        <select className="from-select" value={draft.accountId ?? ""} onChange={(event) => switchAccount(Number(event.target.value))} aria-label="From">
          {sessionAccounts.map((item) => (
            <option key={item.id} value={item.id}>
              {item.display_name} &lt;{item.email}&gt;
            </option>
          ))}
        </select>
        {draft.priority === "high" ? (
          <span className="priority-flag">
            <AlertTriangle size={13} /> High priority
          </span>
        ) : null}
      </div>
      <div className="recipient-wrap">
        <RecipientInput label="To" value={draft.to} onChange={(to) => updateCompose({ to })} autoFocus={!draft.to} />
        {!draft.showCc ? (
          <button type="button" className="cc-toggle" onClick={() => updateCompose({ showCc: true })}>
            Cc Bcc
          </button>
        ) : null}
      </div>
      {draft.showCc ? (
        <>
          <RecipientInput label="Cc" value={draft.cc} onChange={(cc) => updateCompose({ cc })} />
          <RecipientInput label="Bcc" value={draft.bcc} onChange={(bcc) => updateCompose({ bcc })} />
        </>
      ) : null}
      <div className="field-row">
        <input className="subject-input" placeholder="Subject" value={draft.subject} onChange={(event) => updateCompose({ subject: event.target.value })} aria-label="Subject" autoFocus={Boolean(draft.to) && !draft.subject} />
      </div>

      <RichEditor ref={editor} docKey={draft.key} initialHtml={draft.html} onChange={(html) => updateCompose({ html })} onFiles={(files) => void addFiles(files)} placeholder="Write your message…" />

      {draft.files.length ? (
        <div className="compose-files">
          {draft.files.map((file, index) => (
            <span key={`${file.filename}-${index}`} className="file-chip">
              <Paperclip size={13} />
              <span className="file-name">{file.filename}</span>
              <span className="file-size">{formatBytes(file.size)}</span>
              <button type="button" aria-label={`Remove ${file.filename}`} onClick={() => updateCompose({ files: draft.files.filter((_, i) => i !== index) })}>
                <X size={12} />
              </button>
            </span>
          ))}
          <span className="file-total">{formatBytes(total)} of 20 MB</span>
        </div>
      ) : null}

      <div className="composer-foot">
        <div className="send-split">
          <button type="submit" className="btn primary" disabled={sending} title="Send (Ctrl+Enter)">
            <Send size={15} /> Send
          </button>
          <Popover
            placement="up"
            trigger={({ toggle }) => (
              <button type="button" className="btn primary split-arrow" onClick={toggle} aria-label="Schedule send">
                <ChevronDown size={15} />
              </button>
            )}
          >
            {(close) => <TimePicker title="Schedule send" onClose={close} onPick={(when) => void send(when)} />}
          </Popover>
        </div>
        <IconButton icon={Paperclip} label="Attach files" onClick={() => fileInput.current?.click()} />
        <input ref={fileInput} type="file" multiple hidden onChange={(event) => void addFiles(event.target.files).then(() => (event.target.value = ""))} />
        <Popover
          placement="up"
          trigger={({ toggle, open }) => <IconButton icon={MoreHorizontal} label="More options" onClick={toggle} active={open} />}
        >
          {(close) => (
            <>
              <MenuItem
                icon={AlertTriangle}
                label="High priority"
                checked={draft.priority === "high"}
                onClick={() => {
                  updateCompose({ priority: draft.priority === "high" ? "normal" : "high" });
                  close();
                }}
              />
              <MenuItem
                icon={MailCheck}
                label="Request read receipt"
                checked={draft.readReceipt}
                onClick={() => {
                  updateCompose({ readReceipt: !draft.readReceipt });
                  close();
                }}
              />
              <MenuItem
                icon={Clock3}
                label="Schedule send…"
                onClick={() => {
                  close();
                  toast("Use the arrow next to Send to choose a time.");
                }}
              />
            </>
          )}
        </Popover>
        <span className="grow" />
        <span className="draft-state">{draft.draftId ? "Draft saved" : ""}</span>
        <IconButton icon={Trash2} label="Discard draft" onClick={() => void discardCompose()} />
      </div>
      {dragging ? <div className="drop-hint">Drop files to attach</div> : null}
    </form>
  );

  return draft.expanded ? (
    <div className="overlay compose-overlay" onMouseDown={() => updateCompose({ expanded: false })}>
      <div onMouseDown={(event) => event.stopPropagation()}>{body}</div>
    </div>
  ) : (
    body
  );
}
