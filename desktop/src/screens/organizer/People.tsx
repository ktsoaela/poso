import { useEffect, useMemo, useState } from "react";
import { Building2, Cake, Download, Mail, MapPin, Pencil, Phone, Plus, Star, Trash2, Users } from "lucide-react";
import { api, openExternal } from "../../api";
import { Avatar, Empty, IconButton, Modal } from "../../components/ui";
import { useItems, type Person } from "../../organizer";
import { useMail } from "../../state";
import { OrgHeader, SearchBox } from "./common";

type Form = Omit<Person, "id" | "session_id" | "updated_at">;

const EMPTY: Form = { name: "", email: "", phone: "", company: "", title: "", address: "", birthday: "", notes: "", favorite: false };

function displayName(person: Pick<Person, "name" | "email" | "phone">): string {
  return person.name || person.email || person.phone || "Unnamed";
}

function PersonForm({ initial, onCancel, onSave }: { initial: Form; onCancel: () => void; onSave: (form: Form) => void }) {
  const [form, setForm] = useState(initial);
  const set = (patch: Partial<Form>) => setForm((current) => ({ ...current, ...patch }));
  return (
    <form
      className="org-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(form);
      }}
    >
      <div className="grid-2">
        <label className="field span-2">
          <span>Name</span>
          <input autoFocus value={form.name} onChange={(event) => set({ name: event.target.value })} />
        </label>
        <label className="field">
          <span>Email</span>
          <input type="email" value={form.email} onChange={(event) => set({ email: event.target.value })} />
        </label>
        <label className="field">
          <span>Phone</span>
          <input type="tel" value={form.phone} onChange={(event) => set({ phone: event.target.value })} />
        </label>
        <label className="field">
          <span>Company</span>
          <input value={form.company} onChange={(event) => set({ company: event.target.value })} />
        </label>
        <label className="field">
          <span>Job title</span>
          <input value={form.title} onChange={(event) => set({ title: event.target.value })} />
        </label>
        <label className="field">
          <span>Birthday</span>
          <input type="date" value={form.birthday} onChange={(event) => set({ birthday: event.target.value })} />
        </label>
        <label className="field span-2">
          <span>Address</span>
          <textarea rows={2} value={form.address} onChange={(event) => set({ address: event.target.value })} />
        </label>
        <label className="field span-2">
          <span>Notes</span>
          <textarea rows={3} value={form.notes} onChange={(event) => set({ notes: event.target.value })} />
        </label>
      </div>
      <div className="org-foot">
        <span className="grow" />
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn primary" disabled={!form.name.trim() && !form.email.trim() && !form.phone.trim()}>
          Save
        </button>
      </div>
    </form>
  );
}

interface Suggestion {
  email: string;
  name: string;
  count: number;
}

function ImportFromMail({ open, onClose, known, onAdd }: { open: boolean; onClose: () => void; known: Set<string>; onAdd: (items: Suggestion[]) => Promise<void> }) {
  const { boot } = useMail();
  const [rows, setRows] = useState<Suggestion[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || !boot) return;
    void api<{ contacts: Suggestion[] }>(`/api/contacts?session_id=${boot.active_session_id}&limit=200`).then((data) => {
      const fresh = data.contacts.filter((row) => !known.has(row.email.toLowerCase()));
      setRows(fresh);
      setPicked(new Set(fresh.slice(0, 20).map((row) => row.email)));
    });
  }, [open, boot, known]);
  return (
    <Modal open={open} onClose={onClose} title="Add people you email" size="md">
      <div className="org-form">
        <p className="set-hint">These addresses come from mail in this session. Pick the ones to keep in Contacts.</p>
        {rows.length ? (
          <div className="import-list">
            {rows.map((row) => (
              <label key={row.email} className="import-row">
                <input
                  type="checkbox"
                  checked={picked.has(row.email)}
                  onChange={() =>
                    setPicked((current) => {
                      const next = new Set(current);
                      if (next.has(row.email)) next.delete(row.email);
                      else next.add(row.email);
                      return next;
                    })
                  }
                />
                <Avatar name={row.name} email={row.email} size={28} />
                <span className="import-text">
                  <strong>{row.name || row.email}</strong>
                  {row.name ? <span>{row.email}</span> : null}
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p className="nav-empty">Everyone you've emailed is already in Contacts.</p>
        )}
        <div className="org-foot">
          <span className="list-total">{picked.size} selected</span>
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!picked.size || busy}
            onClick={async () => {
              setBusy(true);
              await onAdd(rows.filter((row) => picked.has(row.email)));
              setBusy(false);
              onClose();
            }}
          >
            Add {picked.size || ""}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function PeopleView() {
  const { openCompose, focus, clearFocus, toast } = useMail();
  const { items, create, update, remove } = useItems("people");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mode, setMode] = useState<"view" | "edit" | "new">("view");
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (focus?.view !== "people") return;
    setSelectedId(focus.id);
    setMode("view");
    clearFocus();
  }, [focus, clearFocus]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle
      ? items.filter((item) => [item.name, item.email, item.phone, item.company].some((value) => value.toLowerCase().includes(needle)))
      : items;
    return [...list].sort((a, b) => Number(b.favorite) - Number(a.favorite) || displayName(a).localeCompare(displayName(b)));
  }, [items, query]);
  const known = useMemo(() => new Set(items.map((item) => item.email.toLowerCase()).filter(Boolean)), [items]);
  const selected = items.find((item) => item.id === selectedId) ?? null;

  let lastLetter = "";
  return (
    <section className="org-pane split">
      <div className="org-list">
        <OrgHeader title="Contacts" sub={`${items.length}`}>
          <IconButton icon={Download} label="Add people you email" onClick={() => setImporting(true)} />
          <button
            type="button"
            className="btn primary sm"
            onClick={() => {
              setSelectedId(null);
              setMode("new");
            }}
          >
            <Plus size={15} /> New
          </button>
        </OrgHeader>
        <div className="org-toolbar">
          <SearchBox value={query} onChange={setQuery} placeholder="Search contacts" />
        </div>
        <div className="org-scroll">
          {shown.map((person) => {
            const letter = person.favorite ? "★" : displayName(person).charAt(0).toUpperCase();
            const header = letter !== lastLetter ? letter : "";
            lastLetter = letter;
            return (
              <div key={person.id}>
                {header ? <div className="org-group">{header === "★" ? "Favorites" : header}</div> : null}
                <button
                  type="button"
                  className={`person-row${person.id === selectedId ? " active" : ""}`}
                  onClick={() => {
                    setSelectedId(person.id);
                    setMode("view");
                  }}
                >
                  <Avatar name={person.name} email={person.email || person.phone} size={32} />
                  <span className="person-text">
                    <strong>{displayName(person)}</strong>
                    <span>{person.company || person.email || person.phone}</span>
                  </span>
                </button>
              </div>
            );
          })}
          {!shown.length ? (
            <Empty icon={Users} title={query ? "No matches" : "No contacts yet"} body={query ? undefined : "Add people by hand or pull them from the mail you've exchanged."}>
              {query ? null : (
                <button type="button" className="btn primary-soft sm" onClick={() => setImporting(true)}>
                  <Download size={14} /> Add people you email
                </button>
              )}
            </Empty>
          ) : null}
        </div>
      </div>

      <div className="org-detail">
        {mode === "new" ? (
          <>
            <OrgHeader title="New contact" />
            <PersonForm
              initial={EMPTY}
              onCancel={() => setMode("view")}
              onSave={async (form) => {
                const made = await create(form);
                if (made) {
                  setSelectedId(made.id);
                  setMode("view");
                }
              }}
            />
          </>
        ) : selected && mode === "edit" ? (
          <>
            <OrgHeader title={`Edit ${displayName(selected)}`} />
            <PersonForm
              key={selected.id}
              initial={selected}
              onCancel={() => setMode("view")}
              onSave={async (form) => {
                if (await update(selected.id, form)) setMode("view");
              }}
            />
          </>
        ) : selected ? (
          <div className="person-card">
            <div className="person-hero">
              <Avatar name={selected.name} email={selected.email || selected.phone} size={72} />
              <div>
                <h2>{displayName(selected)}</h2>
                {selected.title || selected.company ? <p>{[selected.title, selected.company].filter(Boolean).join(" · ")}</p> : null}
              </div>
              <span className="grow" />
              <IconButton
                icon={Star}
                label={selected.favorite ? "Remove from favorites" : "Add to favorites"}
                active={selected.favorite}
                onClick={() => void update(selected.id, { favorite: !selected.favorite })}
              />
              <IconButton icon={Pencil} label="Edit" onClick={() => setMode("edit")} />
              <IconButton
                icon={Trash2}
                label="Delete contact"
                className="danger"
                onClick={() => {
                  const removed = selected;
                  void remove(removed.id);
                  setSelectedId(null);
                  toast(`Deleted ${displayName(removed)}`, {
                    action: {
                      label: "Undo",
                      run: () => {
                        const { id: _id, session_id: _session, updated_at: _updated, ...rest } = removed;
                        void create(rest);
                      },
                    },
                  });
                }}
              />
            </div>
            <div className="person-actions">
              <button type="button" className="btn primary sm" disabled={!selected.email} onClick={() => openCompose({ to: selected.name ? `${selected.name} <${selected.email}>` : selected.email })}>
                <Mail size={14} /> Email
              </button>
              <button type="button" className="btn sm" disabled={!selected.phone} onClick={() => void openExternal(`tel:${selected.phone.replace(/[^\d+]/g, "")}`)}>
                <Phone size={14} /> Call
              </button>
            </div>
            <dl className="person-fields">
              {selected.email ? (
                <>
                  <dt>
                    <Mail size={14} /> Email
                  </dt>
                  <dd>{selected.email}</dd>
                </>
              ) : null}
              {selected.phone ? (
                <>
                  <dt>
                    <Phone size={14} /> Phone
                  </dt>
                  <dd>{selected.phone}</dd>
                </>
              ) : null}
              {selected.company ? (
                <>
                  <dt>
                    <Building2 size={14} /> Company
                  </dt>
                  <dd>{selected.company}</dd>
                </>
              ) : null}
              {selected.birthday ? (
                <>
                  <dt>
                    <Cake size={14} /> Birthday
                  </dt>
                  <dd>{new Date(`${selected.birthday}T00:00:00`).toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" })}</dd>
                </>
              ) : null}
              {selected.address ? (
                <>
                  <dt>
                    <MapPin size={14} /> Address
                  </dt>
                  <dd className="pre">{selected.address}</dd>
                </>
              ) : null}
              {selected.notes ? (
                <>
                  <dt>Notes</dt>
                  <dd className="pre">{selected.notes}</dd>
                </>
              ) : null}
            </dl>
          </div>
        ) : (
          <Empty icon={Users} title="Pick a contact" body="Contacts you save here also show first when you address a message." />
        )}
      </div>

      <ImportFromMail
        open={importing}
        onClose={() => setImporting(false)}
        known={known}
        onAdd={async (rows) => {
          let added = 0;
          for (const row of rows) {
            if (await create({ name: row.name, email: row.email })) added += 1;
          }
          toast(`Added ${added} contact${added === 1 ? "" : "s"}`, { tone: "success" });
        }}
      />
    </section>
  );
}
