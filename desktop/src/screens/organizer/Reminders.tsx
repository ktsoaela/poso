import { useEffect, useMemo, useState } from "react";
import { AlarmClock, BellRing, Check, Clock, Pencil, Repeat as RepeatIcon, Trash2 } from "lucide-react";
import { api } from "../../api";
import { notify } from "../../desktop";
import { Empty, IconButton, MenuItem, Modal, Popover } from "../../components/ui";
import { addDays, fromInputs, startOfDay, toDateInput, toTimeInput, useItems, whenLabel, type Reminder, type Repeat } from "../../organizer";
import { useMail } from "../../state";
import { Checkbox, OrgHeader } from "./common";

const REPEATS: { value: Repeat; label: string }[] = [
  { value: "none", label: "Doesn't repeat" },
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Every weekday" },
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
  { value: "yearly", label: "Every year" },
];

function defaultTime(): Date {
  const next = new Date(Date.now() + 60 * 60 * 1000);
  next.setMinutes(next.getMinutes() < 30 ? 30 : 60, 0, 0);
  return next;
}

function tomorrowMorning(): Date {
  return fromInputs(toDateInput(addDays(new Date(), 1)), "09:00") as Date;
}

function ReminderForm({ initial, onSave, onCancel }: { initial: Partial<Reminder>; onSave: (body: Partial<Reminder>) => void; onCancel?: () => void }) {
  const start = initial.remind_at ? new Date(initial.remind_at) : defaultTime();
  const [title, setTitle] = useState(initial.title ?? "");
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [date, setDate] = useState(toDateInput(start));
  const [time, setTime] = useState(toTimeInput(start));
  const [repeat, setRepeat] = useState<Repeat>(initial.repeat ?? "none");
  const editing = Boolean(onCancel);
  return (
    <form
      className={editing ? "org-form" : "reminder-add"}
      onSubmit={(event) => {
        event.preventDefault();
        const when = fromInputs(date, time);
        if (!title.trim() || !when) return;
        onSave({ title: title.trim(), notes, remind_at: when.toISOString(), repeat });
        if (!editing) {
          setTitle("");
          setNotes("");
          const next = defaultTime();
          setDate(toDateInput(next));
          setTime(toTimeInput(next));
          setRepeat("none");
        }
      }}
    >
      <input className={editing ? "org-big-input" : "reminder-title"} autoFocus={editing} placeholder="Remind me to…" value={title} onChange={(event) => setTitle(event.target.value)} />
      <div className="org-inline">
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required aria-label="Date" />
        <input type="time" value={time} onChange={(event) => setTime(event.target.value)} required aria-label="Time" />
        <select value={repeat} onChange={(event) => setRepeat(event.target.value as Repeat)} aria-label="Repeat">
          {REPEATS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        {editing ? null : (
          <button type="submit" className="btn primary" disabled={!title.trim()}>
            Add reminder
          </button>
        )}
      </div>
      {editing ? (
        <>
          <label className="field">
            <span>Notes</span>
            <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
          <div className="org-foot">
            <span className="grow" />
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={!title.trim()}>
              Save
            </button>
          </div>
        </>
      ) : null}
    </form>
  );
}

export function RemindersView() {
  const { focus, clearFocus, toast } = useMail();
  const { items, setItems, create, update, remove } = useItems("reminders");
  const [editing, setEditing] = useState<Reminder | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [, setNow] = useState(Date.now());

  // Re-render each minute so "due" sections move without a reload.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (focus?.view !== "reminders") return;
    setHighlight(focus.id);
    clearFocus();
    const timer = window.setTimeout(() => setHighlight(null), 4000);
    return () => window.clearTimeout(timer);
  }, [focus, clearFocus]);

  const groups = useMemo(() => {
    const now = Date.now();
    const endOfToday = addDays(startOfDay(new Date()), 1).getTime();
    const open = items.filter((item) => !item.done).sort((a, b) => a.remind_at.localeCompare(b.remind_at));
    return [
      { key: "due", title: "Due", rows: open.filter((item) => new Date(item.remind_at).getTime() <= now) },
      { key: "today", title: "Later today", rows: open.filter((item) => new Date(item.remind_at).getTime() > now && new Date(item.remind_at).getTime() < endOfToday) },
      { key: "later", title: "Upcoming", rows: open.filter((item) => new Date(item.remind_at).getTime() >= endOfToday) },
      { key: "done", title: "Done", rows: items.filter((item) => item.done).sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "")).slice(0, 30) },
    ];
  }, [items]);

  const snooze = async (item: Reminder, minutes: number) => {
    try {
      const next = await api<Reminder>(`/api/reminders/${item.id}/snooze`, { method: "POST", body: JSON.stringify({ minutes }) });
      setItems((current) => current.map((row) => (row.id === item.id ? next : row)));
      toast(`Snoozed until ${whenLabel(next.remind_at)}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't snooze.", { tone: "error" });
    }
  };

  const minutesUntil = (date: Date) => Math.max(1, Math.round((date.getTime() - Date.now()) / 60000));

  return (
    <section className="org-pane">
      <OrgHeader title="Reminders" sub={`${items.filter((item) => !item.done).length} active`}>
        <button
          type="button"
          className="btn sm"
          onClick={async () => {
            const shown = await notify({ title: "Poso reminders are on", body: "This is how reminders will appear.", tag: "reminders:0:0" });
            if (!shown) toast("Notifications are blocked. Allow them for Poso in Windows Settings → System → Notifications.", { tone: "error", ttl: 9000 });
          }}
        >
          <BellRing size={14} /> Test notification
        </button>
      </OrgHeader>
      <ReminderForm initial={{}} onSave={(body) => void create(body)} />
      <div className="org-scroll reminders">
        {groups.map((group) =>
          group.rows.length ? (
            <div key={group.key} className="reminder-group">
              <div className="org-group">
                {group.title} <span className="tab-count">{group.rows.length}</span>
              </div>
              {group.rows.map((item) => {
                const due = !item.done && new Date(item.remind_at).getTime() <= Date.now();
                return (
                  <div key={item.id} className={`reminder-row${item.done ? " done" : ""}${due ? " due" : ""}${highlight === item.id ? " flash" : ""}`}>
                    <Checkbox checked={item.done} onChange={(done) => void update(item.id, { done })} label={`Done: ${item.title}`} />
                    <button type="button" className="reminder-text" onClick={() => setEditing(item)}>
                      <span className="task-title">{item.title}</span>
                      <span className="task-meta">
                        <span className={due ? "overdue" : ""}>
                          <Clock size={12} /> {whenLabel(item.remind_at)}
                        </span>
                        {item.repeat !== "none" ? (
                          <span>
                            <RepeatIcon size={12} /> {REPEATS.find((r) => r.value === item.repeat)?.label}
                          </span>
                        ) : null}
                        {item.notes ? <span className="task-note">{item.notes.split("\n")[0]}</span> : null}
                      </span>
                    </button>
                    {item.done ? null : (
                      <Popover
                        align="right"
                        trigger={({ toggle }) => <IconButton icon={AlarmClock} label="Snooze" onClick={toggle} size={16} />}
                      >
                        {(close) => (
                          <>
                            {[
                              { label: "10 minutes", minutes: 10 },
                              { label: "1 hour", minutes: 60 },
                              { label: "3 hours", minutes: 180 },
                              { label: "Tomorrow 9:00", minutes: minutesUntil(tomorrowMorning()) },
                            ].map((option) => (
                              <MenuItem
                                key={option.label}
                                label={option.label}
                                onClick={() => {
                                  close();
                                  void snooze(item, option.minutes);
                                }}
                              />
                            ))}
                          </>
                        )}
                      </Popover>
                    )}
                    <IconButton icon={Pencil} label="Edit" onClick={() => setEditing(item)} size={16} />
                    <IconButton
                      icon={Trash2}
                      label="Delete"
                      size={16}
                      onClick={() => {
                        void remove(item.id);
                        toast("Reminder deleted", { action: { label: "Undo", run: () => void create({ title: item.title, notes: item.notes, remind_at: item.remind_at, repeat: item.repeat }) } });
                      }}
                    />
                  </div>
                );
              })}
            </div>
          ) : null,
        )}
        {!items.length ? <Empty icon={BellRing} title="No reminders" body="Add one above. Poso shows a desktop notification at the time you pick while it's running, even behind other apps." /> : null}
        {items.length && groups.every((group) => group.key === "done" || !group.rows.length) ? (
          <p className="nav-empty all-clear">
            <Check size={14} /> All caught up
          </p>
        ) : null}
      </div>
      {editing ? (
        <Modal open onClose={() => setEditing(null)} title="Edit reminder">
          <ReminderForm
            initial={editing}
            onCancel={() => setEditing(null)}
            onSave={async (body) => {
              if (await update(editing.id, { ...body, done: false })) setEditing(null);
            }}
          />
        </Modal>
      ) : null}
    </section>
  );
}

