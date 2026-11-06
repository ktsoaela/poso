import { useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckSquare, Star, Sun, Trash2, X } from "lucide-react";
import { Empty, IconButton } from "../../components/ui";
import { addDays, fromInputs, startOfDay, toDateInput, toTimeInput, useItems, whenLabel, type Task } from "../../organizer";
import { useMail } from "../../state";
import { Checkbox, OrgHeader } from "./common";

type Filter = "today" | "important" | "planned" | "all" | "done";

const FILTERS: { value: Filter; label: string; icon: typeof Sun }[] = [
  { value: "today", label: "My day", icon: Sun },
  { value: "important", label: "Important", icon: Star },
  { value: "planned", label: "Planned", icon: CalendarClock },
  { value: "all", label: "All", icon: CheckSquare },
  { value: "done", label: "Completed", icon: CheckSquare },
];

function matches(task: Task, filter: Filter, endOfToday: number): boolean {
  if (filter === "done") return task.done;
  if (task.done) return false;
  if (filter === "today") return Boolean(task.due_at && new Date(task.due_at).getTime() < endOfToday);
  if (filter === "important") return task.important;
  if (filter === "planned") return Boolean(task.due_at);
  return true;
}

function TaskDetail({ task, onClose, onChange, onDelete }: { task: Task; onClose: () => void; onChange: (patch: Partial<Task>) => void; onDelete: () => void }) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const due = task.due_at ? new Date(task.due_at) : null;
  const setDue = (date: string, time: string) => {
    const value = fromInputs(date, time || "09:00");
    onChange({ due_at: value ? value.toISOString() : null });
  };
  return (
    <aside className="task-detail">
      <div className="task-detail-head">
        <Checkbox checked={task.done} onChange={(done) => onChange({ done })} label="Completed" />
        <input
          className="org-big-input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => title.trim() && title !== task.title && onChange({ title: title.trim() })}
          onKeyDown={(event) => event.key === "Enter" && (event.target as HTMLInputElement).blur()}
        />
        <IconButton icon={X} label="Close details" onClick={onClose} />
      </div>
      <button type="button" className={`task-flag${task.important ? " on" : ""}`} onClick={() => onChange({ important: !task.important })}>
        <Star size={15} /> {task.important ? "Marked important" : "Mark important"}
      </button>
      <div className="field">
        <span>
          <CalendarClock size={13} /> Due
        </span>
        <div className="org-inline">
          <input type="date" value={due ? toDateInput(due) : ""} onChange={(event) => setDue(event.target.value, due ? toTimeInput(due) : "09:00")} />
          <input type="time" value={due ? toTimeInput(due) : ""} disabled={!due} onChange={(event) => due && setDue(toDateInput(due), event.target.value)} />
        </div>
        <div className="chip-row">
          <button type="button" className="chip-btn" onClick={() => setDue(toDateInput(new Date()), "17:00")}>
            Today
          </button>
          <button type="button" className="chip-btn" onClick={() => setDue(toDateInput(addDays(new Date(), 1)), "09:00")}>
            Tomorrow
          </button>
          <button type="button" className="chip-btn" onClick={() => setDue(toDateInput(addDays(new Date(), 7)), "09:00")}>
            Next week
          </button>
          {due ? (
            <button type="button" className="chip-btn" onClick={() => onChange({ due_at: null })}>
              Clear
            </button>
          ) : null}
        </div>
        <p className="set-hint">You'll get a desktop notification when it's due.</p>
      </div>
      <label className="field">
        <span>Notes</span>
        <textarea rows={8} value={notes} onChange={(event) => setNotes(event.target.value)} onBlur={() => notes !== task.notes && onChange({ notes })} />
      </label>
      <span className="grow" />
      <div className="org-foot">
        <span className="list-total">{task.created_at ? `Created ${whenLabel(task.created_at, false).toLowerCase()}` : ""}</span>
        <span className="grow" />
        <button type="button" className="btn danger-ghost sm" onClick={onDelete}>
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </aside>
  );
}

export function TasksView() {
  const { focus, clearFocus, toast } = useMail();
  const { items, create, update, remove } = useItems("tasks");
  const [filter, setFilter] = useState<Filter>(() => (localStorage.getItem("session.tasks.filter") as Filter) || "all");
  const [draft, setDraft] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const endOfToday = addDays(startOfDay(new Date()), 1).getTime();

  useEffect(() => {
    localStorage.setItem("session.tasks.filter", filter);
  }, [filter]);

  useEffect(() => {
    if (focus?.view !== "tasks") return;
    setFilter("all");
    setSelectedId(focus.id);
    clearFocus();
  }, [focus, clearFocus]);

  const shown = useMemo(
    () =>
      items
        .filter((task) => matches(task, filter, endOfToday))
        .sort((a, b) => {
          if (a.done !== b.done) return Number(a.done) - Number(b.done);
          if (filter === "done") return (b.done_at ?? "").localeCompare(a.done_at ?? "");
          if (!a.due_at !== !b.due_at) return a.due_at ? -1 : 1;
          return (a.due_at ?? "").localeCompare(b.due_at ?? "") || (b.created_at ?? "").localeCompare(a.created_at ?? "");
        }),
    [items, filter, endOfToday],
  );
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((item) => [item.value, items.filter((task) => matches(task, item.value, endOfToday)).length])), [items, endOfToday]);
  const selected = items.find((task) => task.id === selectedId) ?? null;

  const add = async () => {
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    const body: Partial<Task> = { title };
    if (filter === "important") body.important = true;
    if (filter === "today" || filter === "planned") body.due_at = fromInputs(toDateInput(new Date()), "17:00")?.toISOString() ?? null;
    await create(body);
  };

  const toggle = (task: Task, done: boolean) => {
    void update(task.id, { done });
    if (done) toast(`Completed “${task.title}”`, { action: { label: "Undo", run: () => void update(task.id, { done: false }) } });
  };

  return (
    <section className={`org-pane tasks${selected ? " with-detail" : ""}`}>
      <div className="org-list wide">
        <OrgHeader title="To Do" sub={`${items.filter((task) => !task.done).length} open`} />
        <div className="org-toolbar">
          <div className="filter-tabs" role="tablist">
            {FILTERS.map((item) => (
              <button key={item.value} type="button" role="tab" aria-selected={filter === item.value} className={filter === item.value ? "on" : ""} onClick={() => setFilter(item.value)}>
                <item.icon size={14} /> {item.label}
                {counts[item.value] ? <span className="tab-count">{counts[item.value]}</span> : null}
              </button>
            ))}
          </div>
        </div>
        {filter === "done" ? null : (
          <form
            className="task-add"
            onSubmit={(event) => {
              event.preventDefault();
              void add();
            }}
          >
            <span className="round-check ghost" aria-hidden />
            <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Add a task — press Enter to save" />
          </form>
        )}
        <div className="org-scroll">
          {shown.map((task) => {
            const overdue = !task.done && task.due_at && new Date(task.due_at).getTime() < Date.now();
            return (
              <div key={task.id} className={`task-row${task.done ? " done" : ""}${task.id === selectedId ? " active" : ""}`} onClick={() => setSelectedId(task.id)}>
                <span onClick={(event) => event.stopPropagation()}>
                  <Checkbox checked={task.done} onChange={(done) => toggle(task, done)} label={`Complete ${task.title}`} />
                </span>
                <span className="task-text">
                  <span className="task-title">{task.title}</span>
                  {task.due_at || task.notes ? (
                    <span className="task-meta">
                      {task.due_at ? (
                        <span className={overdue ? "overdue" : ""}>
                          <CalendarClock size={12} /> {overdue ? "Overdue · " : ""}
                          {whenLabel(task.due_at)}
                        </span>
                      ) : null}
                      {task.notes ? <span className="task-note">{task.notes.split("\n")[0]}</span> : null}
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  className={`star-btn${task.important ? " on" : ""}`}
                  aria-label={task.important ? "Unmark important" : "Mark important"}
                  onClick={(event) => {
                    event.stopPropagation();
                    void update(task.id, { important: !task.important });
                  }}
                >
                  <Star size={16} />
                </button>
              </div>
            );
          })}
          {!shown.length ? (
            <Empty
              icon={filter === "today" ? Sun : CheckSquare}
              title={filter === "done" ? "Nothing completed yet" : filter === "today" ? "Your day is clear" : "No tasks here"}
              body={filter === "today" ? "Tasks due today or overdue show up here." : "Type above and press Enter to add one."}
            />
          ) : null}
        </div>
      </div>
      {selected ? (
        <TaskDetail
          key={selected.id}
          task={selected}
          onClose={() => setSelectedId(null)}
          onChange={(patch) => {
            if (patch.done !== undefined) toggle(selected, patch.done);
            else void update(selected.id, patch);
          }}
          onDelete={() => {
            const gone = selected;
            setSelectedId(null);
            void remove(gone.id);
            toast(`Deleted “${gone.title}”`, {
              action: { label: "Undo", run: () => void create({ title: gone.title, notes: gone.notes, due_at: gone.due_at, important: gone.important }) },
            });
          }}
        />
      ) : null}
    </section>
  );
}
