import { useMail } from "../state";

export function Composer() {
  const { compose, updateCompose, closeCompose, send, sending, sessionAccounts } = useMail();
  if (!compose) return null;
  const draft = compose;

  async function addFiles(list: FileList | null) {
    if (!list) return;
    const files = await Promise.all(
      [...list].map(
        (file) =>
          new Promise<{ filename: string; content_type: string; data_base64: string }>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = String(reader.result || "");
              const data = result.split(",")[1] || "";
              resolve({ filename: file.name, content_type: file.type || "application/octet-stream", data_base64: data });
            };
            reader.onerror = () => reject(new Error("Couldn't read a file."));
            reader.readAsDataURL(file);
          }),
      ),
    );
    updateCompose({ files: [...draft.files, ...files] });
  }

  return (
    <div className="overlay" role="presentation" onMouseDown={closeCompose}>
      <form
        className="sheet compose stack"
        role="dialog"
        aria-labelledby="compose-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <div className="list-title">
          <h2 id="compose-title">New message</h2>
          <button type="button" className="text-btn" onClick={closeCompose}>
            Close
          </button>
        </div>
        <label className="field">
          <span>From</span>
          <select
            value={compose.accountId ?? ""}
            onChange={(event) => updateCompose({ accountId: Number(event.target.value) })}
          >
            {sessionAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.display_name} · {account.email}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>To</span>
          <input value={compose.to} onChange={(event) => updateCompose({ to: event.target.value })} />
        </label>
        {compose.showCc ? (
          <>
            <label className="field">
              <span>Cc</span>
              <input value={compose.cc} onChange={(event) => updateCompose({ cc: event.target.value })} />
            </label>
            <label className="field">
              <span>Bcc</span>
              <input value={compose.bcc} onChange={(event) => updateCompose({ bcc: event.target.value })} />
            </label>
          </>
        ) : (
          <button type="button" className="text-btn" onClick={() => updateCompose({ showCc: true })}>
            Cc / Bcc
          </button>
        )}
        <label className="field">
          <span>Subject</span>
          <input value={compose.subject} onChange={(event) => updateCompose({ subject: event.target.value })} />
        </label>
        <label className="field">
          <span>Message</span>
          <textarea rows={10} value={compose.body} onChange={(event) => updateCompose({ body: event.target.value })} />
        </label>
        {compose.files.length > 0 ? <p className="meta">{compose.files.map((file) => file.filename).join(", ")}</p> : null}
        <div className="row-actions">
          <label className="text-btn">
            Attach
            <input className="sr-only" type="file" multiple onChange={(event) => void addFiles(event.target.files)} />
          </label>
          <button className="btn primary" type="submit" disabled={sending}>
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}
