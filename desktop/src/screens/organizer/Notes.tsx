import { useEffect, useMemo, useRef, useState } from "react";
import { NotebookPen, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import { relative } from "../../format";
import { Empty, IconButton } from "../../components/ui";
import { useItems, type Note } from "../../organizer";
import { useMail } from "../../state";
import { OrgHeader, SearchBox, Swatches } from "./common";

const NOTE_COLORS = ["", "#f59e0b", "#10b981", "#0ea5e9", "#8b5cf6", "#ec4899", "#ef4444"];

function preview(note: Note): { title: string; line: string } {
  const lines = note.body.split("\n").map((line) => line.trim()).filter(Boolean);
  const title = note.title.trim() || lines.shift() || "New note";
  return { title, line: lines[0] ?? "" };
}

function Editor({ note, onSave, onDelete, onPin, onColor }: { note: Note; onSave: (patch: Partial<Note>) => void; onDelete: () => void; onPin: () => void; onColor: (color: string) => void }) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const pending = useRef<Partial<Note>>({});
  const timer = useRef(0);
  const save = useRef(onSave);
  save.current = onSave;

  const flush = () => {
    window.clearTimeout(timer.current);
    if (Object.keys(pending.current).length) {
      save.current(pending.current);
      pending.current = {};
    }
  };
  const queue = (patch: Partial<Note>) => {
    pending.current = { ...pending.current, ...patch };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 600);
  };
  // Save whatever is pending when switching notes or leaving the screen.
  useEffect(() => flush, []);

  return (
    <div className="note-editor" style={note.color ? { ["--note" as string]: note.color } : undefined}>
      <div className="note-tools">
        <span className="list-total">Edited {relative(note.updated_at ?? new Date().toISOString())}</span>
        <span className="grow" />
        <Swatches colors={NOTE_COLORS} value={note.color} onChange={onColor} />
        <IconButton icon={note.pinned ? PinOff : Pin} label={note.pinned ? "Unpin" : "Pin to top"} active={note.pinned} onClick={onPin} />
        <IconButton icon={Trash2} label="Delete note" className="danger" onClick={onDelete} />
      </div>
      <input
        className="note-title"
        placeholder="Title"
        value={title}
        onChange={(event) => {
          setTitle(event.target.value);
          queue({ title: event.target.value });
        }}
        onBlur={flush}
      />
      <textarea
        className="note-body"
        placeholder="Start writing…"
        autoFocus={!note.body && !note.title}
        value={body}
        onChange={(event) => {
          setBody(event.target.value);
          queue({ body: event.target.value });
        }}
        onBlur={flush}
      />
    </div>
  );
}

export function NotesView() {
  const { focus, clearFocus, toast } = useMail();
  const { items, create, update, remove } = useItems("notes");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    if (focus?.view !== "notes") return;
    setSelectedId(focus.id);
    clearFocus();
  }, [focus, clearFocus]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle ? items.filter((note) => `${note.title}\n${note.body}`.toLowerCase().includes(needle)) : items;
    return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
  }, [items, query]);
  const selected = items.find((note) => note.id === selectedId) ?? shown[0] ?? null;

  // Lock onto a concrete note so edits that re-sort the list don't swap the open note.
  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);

  const add = async () => {
    const note = await create({ title: "", body: "" });
    if (note) {
      setQuery("");
      setSelectedId(note.id);
    }
  };

  return (
    <section className="org-pane split">
      <div className="org-list">
        <OrgHeader title="Notes" sub={`${items.length}`}>
          <button type="button" className="btn primary sm" onClick={() => void add()}>
            <Plus size={15} /> New note
          </button>
        </OrgHeader>
        <div className="org-toolbar">
          <SearchBox value={query} onChange={setQuery} placeholder="Search notes" />
        </div>
        <div className="org-scroll">
          {shown.map((note) => {
            const { title, line } = preview(note);
            return (
              <button
                key={note.id}
                type="button"
                className={`note-row${note.id === selected?.id ? " active" : ""}`}
                style={note.color ? { ["--note" as string]: note.color } : undefined}
                onClick={() => setSelectedId(note.id)}
              >
                <span className="note-row-title">
                  {note.pinned ? <Pin size={12} /> : null}
                  {title}
                </span>
                <span className="note-row-meta">
                  <span>{relative(note.updated_at ?? "")}</span>
                  <span className="note-row-line">{line}</span>
                </span>
              </button>
            );
          })}
          {!shown.length ? <Empty icon={NotebookPen} title={query ? "No matches" : "No notes yet"} body={query ? undefined : "Jot down anything. Notes save as you type."} /> : null}
        </div>
      </div>
      <div className="org-detail">
        {selected ? (
          <Editor
            key={selected.id}
            note={selected}
            onSave={(patch) => void update(selected.id, patch)}
            onPin={() => void update(selected.id, { pinned: !selected.pinned })}
            onColor={(color) => void update(selected.id, { color })}
            onDelete={() => {
              const gone = selected;
              setSelectedId(null);
              void remove(gone.id);
              toast("Note deleted", { action: { label: "Undo", run: () => void create({ title: gone.title, body: gone.body, color: gone.color, pinned: gone.pinned }) } });
            }}
          />
        ) : (
          <Empty icon={NotebookPen} title="No note selected">
            <button type="button" className="btn primary-soft sm" onClick={() => void add()}>
              <Plus size={14} /> New note
            </button>
          </Empty>
        )}
      </div>
    </section>
  );
}
