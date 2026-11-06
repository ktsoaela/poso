import { useRef, useState } from "react";
import { DatabaseBackup, Download, FileArchive, FileUp, Mail, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, downloadFile } from "../../api";
import { useMail } from "../../state";

const FORMATS: { id: string; label: string; detail: string; icon: LucideIcon }[] = [
  { id: "mbox", label: "MBOX", detail: "One file. Opens in Thunderbird, Apple Mail, and most clients.", icon: Mail },
  { id: "eml", label: "EML (zip)", detail: "One .eml per message, organised by account and folder. Outlook can open these.", icon: FileArchive },
  { id: "json", label: "Session backup (JSON)", detail: "Mail, labels, rules, signatures, and block lists. Restorable below.", icon: DatabaseBackup },
  { id: "contacts", label: "Contacts (CSV)", detail: "Everyone you've written to or heard from in this session.", icon: Users },
];

const FOLDERS = ["", "inbox", "sent", "archive", "drafts", "spam", "trash"];

export function DataTab() {
  const { boot, sessionAccounts, activeSession, toast, reload } = useMail();
  const [format, setFormat] = useState("mbox");
  const [scope, setScope] = useState<"session" | "all" | number>("session");
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [importAccount, setImportAccount] = useState<number>(sessionAccounts[0]?.id ?? 0);
  const [importFolder, setImportFolder] = useState("inbox");
  const [upload, setUpload] = useState(false);
  const [files, setFiles] = useState<FileList | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  if (!boot) return null;
  const importTarget = boot.accounts.find((item) => item.id === importAccount);

  const runExport = async () => {
    const params = new URLSearchParams({ fmt: format });
    if (scope === "session" || format === "contacts") params.set("session_id", String(boot.active_session_id));
    if (typeof scope === "number") params.set("account_id", String(scope));
    if (folder && (format === "mbox" || format === "eml")) params.set("folder_role", folder);
    setBusy(true);
    try {
      const name = await downloadFile(`/api/export?${params}`, "export");
      toast(`Exported ${name}`, { tone: "success" });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Export failed.", { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    if (!files?.length || !importAccount) return;
    const form = new FormData();
    form.set("account_id", String(importAccount));
    form.set("folder_role", importFolder);
    form.set("upload", upload ? "true" : "false");
    [...files].forEach((file) => form.append("files", file, file.name));
    setBusy(true);
    try {
      const result = await api<{ imported: number; skipped: number; uploaded: number }>("/api/import", { method: "POST", body: form });
      toast(`Imported ${result.imported} message${result.imported === 1 ? "" : "s"}${result.skipped ? `, skipped ${result.skipped}` : ""}${result.uploaded ? `, uploaded ${result.uploaded} to the server` : ""}`, { tone: "success", ttl: 8000 });
      setFiles(null);
      if (fileInput.current) fileInput.current.value = "";
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Import failed.", { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const runRestore = async (file: File | undefined) => {
    if (!file) return;
    const form = new FormData();
    form.set("file", file, file.name);
    setBusy(true);
    try {
      const result = await api<{ sessions: number; labels: number; rules: number; messages: number; skipped_accounts: string[] }>("/api/restore", { method: "POST", body: form });
      const skipped = result.skipped_accounts.length ? ` Add ${result.skipped_accounts.join(", ")} first to restore their mail.` : "";
      toast(`Restored ${result.messages} messages, ${result.labels} labels, ${result.rules} rules.${skipped}`, { tone: "success", ttl: 10000 });
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Restore failed.", { tone: "error" });
    } finally {
      setBusy(false);
      if (restoreInput.current) restoreInput.current.value = "";
    }
  };

  return (
    <>
      <section className="set-section">
        <div className="set-section-head">
          <h3>Export</h3>
          <p>Take your mail anywhere. Exports are logged in the audit trail.</p>
        </div>
        <div className="format-grid">
          {FORMATS.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} type="button" className={`format-card${format === item.id ? " on" : ""}`} onClick={() => setFormat(item.id)}>
                <Icon size={18} />
                <strong>{item.label}</strong>
                <span>{item.detail}</span>
              </button>
            );
          })}
        </div>
        <div className="grid-2">
          <label className="field">
            <span>What to include</span>
            <select
              value={String(scope)}
              disabled={format === "contacts"}
              onChange={(event) => {
                const value = event.target.value;
                setScope(value === "session" || value === "all" ? value : Number(value));
              }}
            >
              <option value="session">This session ({activeSession?.name})</option>
              <option value="all">All sessions</option>
              {format !== "json"
                ? sessionAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      Only {account.email}
                    </option>
                  ))
                : null}
            </select>
          </label>
          <label className="field">
            <span>Folder</span>
            <select value={folder} disabled={format === "json" || format === "contacts"} onChange={(event) => setFolder(event.target.value)}>
              {FOLDERS.map((item) => (
                <option key={item} value={item}>
                  {item ? item[0].toUpperCase() + item.slice(1) : "All folders"}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-actions">
          <button type="button" className="btn primary" disabled={busy} onClick={() => void runExport()}>
            <Download size={15} /> {busy ? "Working…" : "Export"}
          </button>
        </div>
      </section>

      <section className="set-section">
        <div className="set-section-head">
          <h3>Import mail</h3>
          <p>Bring in .eml files, .mbox files (Thunderbird, Apple Mail, Google Takeout), or a .zip of .eml files. Duplicates are skipped.</p>
        </div>
        <div className="grid-2">
          <label className="field">
            <span>Into account</span>
            <select value={importAccount} onChange={(event) => setImportAccount(Number(event.target.value))}>
              {boot.sessions.map((session) => (
                <optgroup key={session.id} label={session.name}>
                  {boot.accounts
                    .filter((item) => item.session_id === session.id)
                    .map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.email}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Folder</span>
            <select value={importFolder} onChange={(event) => setImportFolder(event.target.value)}>
              {FOLDERS.filter(Boolean).map((item) => (
                <option key={item} value={item}>
                  {item[0].toUpperCase() + item.slice(1)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="button" className={`dropzone${files?.length ? " has" : ""}`} onClick={() => fileInput.current?.click()}>
          <FileUp size={22} />
          <span>{files?.length ? `${files.length} file${files.length === 1 ? "" : "s"} selected: ${[...files].map((file) => file.name).join(", ")}` : "Choose .eml, .mbox, or .zip files"}</span>
        </button>
        <input ref={fileInput} type="file" multiple accept=".eml,.mbox,.mbx,.zip,message/rfc822" hidden onChange={(event) => setFiles(event.target.files)} />
        {importTarget && importTarget.auth_type !== "local" ? (
          <label className="check">
            <input type="checkbox" checked={upload} onChange={(event) => setUpload(event.target.checked)} /> Also upload to the {importTarget.provider} server so it syncs to your other devices
          </label>
        ) : null}
        <div className="form-actions">
          <button type="button" className="btn primary" disabled={busy || !files?.length} onClick={() => void runImport()}>
            <FileUp size={15} /> Import
          </button>
        </div>
      </section>

      <section className="set-section">
        <div className="set-section-head">
          <h3>Restore a Session backup</h3>
          <p>Restores labels, rules, block lists, signatures, and mail for accounts that already exist here. Nothing is overwritten.</p>
        </div>
        <div className="form-actions start">
          <button type="button" className="btn" disabled={busy} onClick={() => restoreInput.current?.click()}>
            <DatabaseBackup size={15} /> Choose backup file…
          </button>
          <input ref={restoreInput} type="file" accept=".json,application/json" hidden onChange={(event) => void runRestore(event.target.files?.[0])} />
        </div>
      </section>
    </>
  );
}
