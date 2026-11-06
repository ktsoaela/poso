import { useState } from "react";
import {
  AlarmClock,
  AlertCircle,
  Archive,
  ChevronRight,
  Clock3,
  FileText,
  Filter,
  Flag,
  Folder,
  History,
  Inbox,
  Mails,
  PanelLeftClose,
  PanelLeftOpen,
  PenSquare,
  Plus,
  Send,
  ShieldAlert,
  Tag,
  Trash2,
  ArrowDownUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { folderLabel } from "../format";
import { useMail } from "../state";
import type { Mailbox, RoleName } from "../types";
import { Kbd } from "./ui";

const ROLES: { role: RoleName; label: string; icon: LucideIcon }[] = [
  { role: "inbox", label: "Inbox", icon: Inbox },
  { role: "flagged", label: "Flagged", icon: Flag },
  { role: "snoozed", label: "Snoozed", icon: AlarmClock },
  { role: "drafts", label: "Drafts", icon: FileText },
  { role: "scheduled", label: "Scheduled", icon: Clock3 },
  { role: "sent", label: "Sent", icon: Send },
  { role: "archive", label: "Archive", icon: Archive },
  { role: "everything", label: "All mail", icon: Mails },
  { role: "spam", label: "Spam", icon: ShieldAlert },
  { role: "trash", label: "Trash", icon: Trash2 },
];

function same(a: Mailbox, b: Mailbox): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "role" && b.kind === "role") return a.role === b.role && (a.accountId ?? 0) === (b.accountId ?? 0);
  if (a.kind === "folder" && b.kind === "folder") return a.folderId === b.folderId;
  if (a.kind === "label" && b.kind === "label") return a.labelId === b.labelId;
  return false;
}

interface NavProps {
  icon: LucideIcon;
  label: string;
  count?: number;
  muted?: boolean;
  active: boolean;
  onClick: () => void;
  color?: string;
  collapsed: boolean;
  strong?: boolean;
}

function NavItem({ icon: Icon, label, count, muted, active, onClick, color, collapsed, strong }: NavProps) {
  return (
    <button type="button" className={`nav-item${active ? " active" : ""}`} onClick={onClick} title={collapsed ? label : undefined}>
      {color ? <span className="nav-swatch" style={{ background: color }} /> : <Icon size={17} strokeWidth={1.9} />}
      {collapsed ? null : <span className="nav-label">{label}</span>}
      {count ? <span className={`nav-count${muted ? " muted" : ""}${strong ? " strong" : ""}`}>{count > 999 ? "999+" : count}</span> : null}
    </button>
  );
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { boot, mailbox, setMailbox, sessionAccounts, sessionLabels, drafts, outbox, openCompose, openSettings, createLabel } = useMail();
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState(false);
  const [labelName, setLabelName] = useState("");
  if (!boot) return null;
  const sessionKey = String(boot.active_session_id);
  const accountIds = new Set(sessionAccounts.map((account) => account.id));
  const folders = boot.folders.filter((folder) => accountIds.has(folder.account_id));
  const unread = (role: string) => folders.filter((folder) => folder.role === role).reduce((sum, folder) => sum + folder.unread, 0);
  const counts: Partial<Record<RoleName, { value: number; muted?: boolean; strong?: boolean }>> = {
    inbox: { value: unread("inbox"), strong: true },
    flagged: { value: boot.counts.flagged[sessionKey] ?? 0, muted: true },
    snoozed: { value: boot.counts.snoozed[sessionKey] ?? 0, muted: true },
    drafts: { value: drafts.length, muted: true },
    scheduled: { value: outbox.length, muted: true },
    spam: { value: unread("spam") },
  };

  return (
    <aside className={`sidebar${collapsed ? " collapsed" : ""}`}>
      <button type="button" className="compose-btn" onClick={() => openCompose()} title="New message (C)">
        <PenSquare size={18} strokeWidth={2} />
        {collapsed ? null : (
          <>
            <span>New message</span>
            <Kbd>C</Kbd>
          </>
        )}
      </button>

      <nav className="nav-scroll" aria-label="Mailboxes">
        <div className="nav-group">
          {ROLES.filter((item) => item.role !== "scheduled" || outbox.length > 0).map((item) => {
            const target: Mailbox = { kind: "role", role: item.role };
            const count = counts[item.role];
            return (
              <NavItem
                key={item.role}
                icon={item.icon}
                label={item.label}
                count={count?.value}
                muted={count?.muted}
                strong={count?.strong}
                active={same(mailbox, target)}
                onClick={() => setMailbox(target)}
                collapsed={collapsed}
              />
            );
          })}
        </div>

        <div className="nav-group">
          {collapsed ? null : (
            <div className="nav-heading">
              <span>Labels</span>
              <button type="button" className="nav-heading-btn" aria-label="New label" onClick={() => setAdding((value) => !value)}>
                <Plus size={14} />
              </button>
            </div>
          )}
          {adding && !collapsed ? (
            <form
              className="nav-add"
              onSubmit={(event) => {
                event.preventDefault();
                const name = labelName.trim();
                if (!name) return;
                void createLabel(name).then(() => {
                  setLabelName("");
                  setAdding(false);
                });
              }}
            >
              <input autoFocus placeholder="Label name" value={labelName} onChange={(event) => setLabelName(event.target.value)} onKeyDown={(event) => event.key === "Escape" && setAdding(false)} />
            </form>
          ) : null}
          {sessionLabels.map((label) => {
            const target: Mailbox = { kind: "label", labelId: label.id };
            return (
              <NavItem
                key={label.id}
                icon={Tag}
                label={label.name}
                color={label.color}
                active={same(mailbox, target)}
                onClick={() => setMailbox(target)}
                collapsed={collapsed}
              />
            );
          })}
          {!sessionLabels.length && !collapsed && !adding ? <p className="nav-empty">Labels group mail across accounts.</p> : null}
        </div>

        <div className="nav-group">
          {collapsed ? null : <div className="nav-heading"><span>Accounts</span></div>}
          {sessionAccounts.map((account) => {
            const expanded = open.has(account.id);
            const own = folders.filter((folder) => folder.account_id === account.id);
            const inbox = own.find((folder) => folder.role === "inbox");
            const custom = own.filter((folder) => folder.role === "custom");
            const target: Mailbox = { kind: "role", role: "inbox", accountId: account.id };
            return (
              <div key={account.id} className="account-node">
                <div className={`nav-item account-row${same(mailbox, target) ? " active" : ""}`}>
                  {collapsed ? null : (
                    <button
                      type="button"
                      className={`twisty${expanded ? " open" : ""}`}
                      aria-label={expanded ? "Collapse folders" : "Expand folders"}
                      onClick={() =>
                        setOpen((current) => {
                          const next = new Set(current);
                          if (next.has(account.id)) next.delete(account.id);
                          else next.add(account.id);
                          return next;
                        })
                      }
                    >
                      <ChevronRight size={14} />
                    </button>
                  )}
                  <button type="button" className="account-main" onClick={() => setMailbox(target)} title={account.email}>
                    <span className="account-dot" style={{ background: account.color }} />
                    {collapsed ? null : (
                      <span className="account-text">
                        <span className="account-name">{account.display_name || account.email}</span>
                        <span className="account-email">{account.email}</span>
                      </span>
                    )}
                    {account.last_error ? <AlertCircle size={15} className="account-error" aria-label={account.last_error} /> : null}
                    {inbox?.unread ? <span className="nav-count">{inbox.unread}</span> : null}
                  </button>
                </div>
                {expanded && !collapsed ? (
                  <div className="account-folders">
                    {(["sent", "archive", "spam", "trash"] as RoleName[]).map((role) => {
                      const sub: Mailbox = { kind: "role", role, accountId: account.id };
                      const Icon = ROLES.find((item) => item.role === role)?.icon ?? Folder;
                      return (
                        <NavItem
                          key={role}
                          icon={Icon}
                          label={ROLES.find((item) => item.role === role)?.label ?? role}
                          active={same(mailbox, sub)}
                          onClick={() => setMailbox(sub)}
                          collapsed={false}
                        />
                      );
                    })}
                    {custom.map((folder) => {
                      const sub: Mailbox = { kind: "folder", folderId: folder.id };
                      return (
                        <NavItem
                          key={folder.id}
                          icon={Folder}
                          label={folderLabel(folder.imap_name)}
                          count={folder.unread}
                          muted
                          active={same(mailbox, sub)}
                          onClick={() => setMailbox(sub)}
                          collapsed={false}
                        />
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="nav-group">
          {collapsed ? null : <div className="nav-heading"><span>Tools</span></div>}
          <NavItem icon={Filter} label="Rules & filters" active={false} onClick={() => openSettings("rules")} collapsed={collapsed} />
          <NavItem icon={ArrowDownUp} label="Import & export" active={false} onClick={() => openSettings("data")} collapsed={collapsed} />
          <NavItem icon={History} label="Audit log" active={false} onClick={() => openSettings("audit")} collapsed={collapsed} />
        </div>
      </nav>

      <button type="button" className="collapse-btn" onClick={onToggle} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
        {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        {collapsed ? null : <span>Collapse</span>}
      </button>
    </aside>
  );
}
