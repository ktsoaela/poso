import { folderLabel } from "../format";
import { useMail } from "../state";
import type { RoleName } from "../types";

const ROLES: { role: RoleName; label: string }[] = [
  { role: "inbox", label: "Inbox" },
  { role: "spam", label: "Spam" },
  { role: "sent", label: "Sent" },
  { role: "drafts", label: "Drafts" },
  { role: "archive", label: "Archive" },
  { role: "trash", label: "Trash" },
];

export function FolderPane() {
  const { boot, mailbox, setMailbox, sessionAccounts, drafts, setSettingsOpen } = useMail();
  if (!boot) return null;
  const accountIds = new Set(sessionAccounts.map((account) => account.id));
  const folders = boot.folders.filter((folder) => accountIds.has(folder.account_id));
  const count = (role: RoleName) =>
    role === "drafts"
      ? drafts.length + folders.filter((folder) => folder.role === "drafts").reduce((sum, folder) => sum + folder.unread, 0)
      : folders.filter((folder) => folder.role === role).reduce((sum, folder) => sum + folder.unread, 0);

  return (
    <>
      <nav className="nav" aria-label="Folders">
        {ROLES.map((item) => {
          const active = mailbox.kind === "role" && mailbox.role === item.role && !mailbox.accountId;
          const unread = count(item.role);
          return (
            <button
              key={item.role}
              className={active ? "nav-btn active" : "nav-btn"}
              onClick={() => setMailbox({ kind: "role", role: item.role })}
            >
              <span>{item.label}</span>
              {unread > 0 ? <span className="count">{unread}</span> : null}
            </button>
          );
        })}
      </nav>
      <div className="scroll-nav">
        {sessionAccounts.map((account) => {
          const own = folders.filter((folder) => folder.account_id === account.id && (folder.role === "custom" || folder.role === "inbox"));
          return (
            <div className="account-block" key={account.id}>
              <div className="account-label">
                <span className="dot" style={{ background: account.color }} />
                <span>{account.email}</span>
              </div>
              {account.last_error ? <div className="error-line">{account.last_error}</div> : null}
              {own.map((folder) => {
                const active = mailbox.kind === "folder" && mailbox.folderId === folder.id;
                return (
                  <button
                    key={folder.id}
                    className={active ? "folder-btn active" : "folder-btn"}
                    onClick={() => setMailbox({ kind: "folder", folderId: folder.id })}
                  >
                    <span>{folder.role === "inbox" ? "Inbox" : folderLabel(folder.imap_name)}</span>
                    {folder.unread > 0 ? <span>{folder.unread}</span> : null}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="sidebar-foot">
        <button className="text-btn" onClick={() => setSettingsOpen(true)}>
          Settings
        </button>
      </div>
    </>
  );
}
