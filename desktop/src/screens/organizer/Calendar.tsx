import { useEffect, useMemo, useState } from "react";
import { Bell, CalendarDays, ChevronLeft, ChevronRight, MapPin, Plus, Trash2 } from "lucide-react";
import { api } from "../../api";
import { Empty, IconButton, Modal, Toggle } from "../../components/ui";
import {
  addDays,
  EVENT_COLORS,
  fromInputs,
  sameDay,
  startOfDay,
  timeLabel,
  toDateInput,
  toTimeInput,
  useItems,
  type CalendarEvent,
} from "../../organizer";
import { useMail } from "../../state";
import { OrgHeader, Swatches } from "./common";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ALERTS: { value: string; label: string }[] = [
  { value: "", label: "No alert" },
  { value: "0", label: "At start time" },
  { value: "5", label: "5 minutes before" },
  { value: "10", label: "10 minutes before" },
  { value: "15", label: "15 minutes before" },
  { value: "30", label: "30 minutes before" },
  { value: "60", label: "1 hour before" },
  { value: "120", label: "2 hours before" },
  { value: "1440", label: "1 day before" },
];

/** Monday-first grid of 6 weeks covering the month that contains `month`. */
function gridStart(month: Date): Date {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  return addDays(first, -offset);
}

function eventsOn(day: Date, events: CalendarEvent[]): CalendarEvent[] {
  const start = startOfDay(day).getTime();
  const end = addDays(startOfDay(day), 1).getTime();
  return events
    .filter((item) => {
      const s = new Date(item.starts_at).getTime();
      const e = new Date(item.ends_at).getTime();
      // all-day and timed events both count on every day they overlap
      return s < end && (e > start || s >= start);
    })
    .sort((a, b) => Number(b.all_day) - Number(a.all_day) || a.starts_at.localeCompare(b.starts_at));
}

interface Draft {
  id: number | null;
  title: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  location: string;
  notes: string;
  color: string;
  alert: string;
}

function draftFor(event: CalendarEvent | null, day: Date): Draft {
  if (event) {
    const start = new Date(event.starts_at);
    const end = new Date(event.ends_at);
    const shownEnd = event.all_day ? addDays(end, -1) : end;
    return {
      id: event.id,
      title: event.title,
      allDay: event.all_day,
      startDate: toDateInput(start),
      startTime: toTimeInput(start),
      endDate: toDateInput(shownEnd < start ? start : shownEnd),
      endTime: toTimeInput(end),
      location: event.location,
      notes: event.notes,
      color: event.color,
      alert: event.remind_minutes == null ? "" : String(event.remind_minutes),
    };
  }
  const now = new Date();
  const hour = sameDay(day, now) ? Math.min(now.getHours() + 1, 23) : 9;
  return {
    id: null,
    title: "",
    allDay: false,
    startDate: toDateInput(day),
    startTime: `${String(hour).padStart(2, "0")}:00`,
    endDate: toDateInput(day),
    endTime: `${String(Math.min(hour + 1, 23)).padStart(2, "0")}:${hour === 23 ? "59" : "00"}`,
    location: "",
    notes: "",
    color: "",
    alert: "10",
  };
}

function EventEditor({ draft, onClose, onSave, onDelete }: { draft: Draft; onClose: () => void; onSave: (draft: Draft) => void; onDelete: (id: number) => void }) {
  const [form, setForm] = useState(draft);
  const set = (patch: Partial<Draft>) => setForm((current) => ({ ...current, ...patch }));
  return (
    <Modal open onClose={onClose} title={form.id ? "Edit event" : "New event"}>
      <form
        className="org-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(form);
        }}
      >
        <input className="org-big-input" autoFocus placeholder="Add a title" value={form.title} onChange={(event) => set({ title: event.target.value })} />
        <div className="org-row">
          <span className="check">
            <Toggle label="All day" checked={form.allDay} onChange={(allDay) => set({ allDay })} /> All day
          </span>
        </div>
        <div className="grid-2">
          <label className="field">
            <span>Starts</span>
            <div className="org-inline">
              <input
                type="date"
                value={form.startDate}
                onChange={(event) => set({ startDate: event.target.value, endDate: form.endDate < event.target.value ? event.target.value : form.endDate })}
                required
              />
              {form.allDay ? null : <input type="time" value={form.startTime} onChange={(event) => set({ startTime: event.target.value })} required />}
            </div>
          </label>
          <label className="field">
            <span>Ends</span>
            <div className="org-inline">
              <input type="date" value={form.endDate} min={form.startDate} onChange={(event) => set({ endDate: event.target.value })} required />
              {form.allDay ? null : <input type="time" value={form.endTime} onChange={(event) => set({ endTime: event.target.value })} required />}
            </div>
          </label>
        </div>
        <label className="field">
          <span>
            <MapPin size={13} /> Location
          </span>
          <input value={form.location} onChange={(event) => set({ location: event.target.value })} placeholder="Room, address or link" />
        </label>
        <div className="grid-2">
          <label className="field">
            <span>
              <Bell size={13} /> Alert
            </span>
            <select value={form.alert} onChange={(event) => set({ alert: event.target.value })}>
              {ALERTS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span>Color</span>
            <Swatches colors={["", ...EVENT_COLORS]} value={form.color} onChange={(color) => set({ color })} />
          </div>
        </div>
        <label className="field">
          <span>Notes</span>
          <textarea rows={4} value={form.notes} onChange={(event) => set({ notes: event.target.value })} />
        </label>
        <div className="org-foot">
          {form.id ? (
            <button type="button" className="btn danger-ghost" onClick={() => onDelete(form.id as number)}>
              <Trash2 size={15} /> Delete
            </button>
          ) : null}
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function CalendarView() {
  const { focus, clearFocus, toast } = useMail();
  const [month, setMonth] = useState(() => startOfDay(new Date()));
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const [editing, setEditing] = useState<Draft | null>(null);
  const firstTime = gridStart(month).getTime();
  const first = new Date(firstTime);
  const range = useMemo(() => {
    const start = new Date(firstTime);
    return { start: start.toISOString(), end: addDays(start, 42).toISOString() };
  }, [firstTime]);
  const { items: events, create, update, remove, sessionId } = useItems("events", range);
  const today = startOfDay(new Date());
  const days = Array.from({ length: 42 }, (_, index) => addDays(first, index));
  const dayEvents = eventsOn(selected, events);

  // Opened from a notification or the palette: jump to the event's month and open it.
  useEffect(() => {
    if (focus?.view !== "calendar" || !sessionId) return;
    const id = focus.id;
    clearFocus();
    void api<{ items: CalendarEvent[] }>(`/api/events?session_id=${sessionId}`).then((data) => {
      const found = data.items.find((item) => item.id === id);
      if (!found) return;
      const day = startOfDay(new Date(found.starts_at));
      setMonth(day);
      setSelected(day);
      setEditing(draftFor(found, day));
    });
  }, [focus, clearFocus, sessionId]);

  const save = async (form: Draft) => {
    const allDay = form.allDay;
    const start = fromInputs(form.startDate, allDay ? "00:00" : form.startTime);
    let end = allDay ? fromInputs(form.endDate, "00:00") : fromInputs(form.endDate, form.endTime);
    if (!start || !end) return;
    if (allDay) end = addDays(end, 1);
    if (end <= start) {
      toast("The event has to end after it starts.", { tone: "error" });
      return;
    }
    const body: Partial<CalendarEvent> = {
      title: form.title.trim() || "Untitled event",
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      all_day: allDay,
      location: form.location,
      notes: form.notes,
      color: form.color,
      remind_minutes: form.alert === "" ? null : Number(form.alert),
    };
    const done = form.id ? await update(form.id, body) : await create(body);
    if (done) setEditing(null);
  };

  const shift = (months: number) => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + months, 1));

  return (
    <section className="org-pane calendar">
      <OrgHeader title={month.toLocaleDateString([], { month: "long", year: "numeric" })}>
        <IconButton icon={ChevronLeft} label="Previous month" onClick={() => shift(-1)} />
        <button
          type="button"
          className="btn sm"
          onClick={() => {
            setMonth(today);
            setSelected(today);
          }}
        >
          Today
        </button>
        <IconButton icon={ChevronRight} label="Next month" onClick={() => shift(1)} />
        <button type="button" className="btn primary sm" onClick={() => setEditing(draftFor(null, selected))}>
          <Plus size={15} /> New event
        </button>
      </OrgHeader>
      <div className="cal-body">
        <div className="cal-grid" role="grid">
          {WEEKDAYS.map((name) => (
            <div key={name} className="cal-weekday" role="columnheader">
              {name}
            </div>
          ))}
          {days.map((day) => {
            const list = eventsOn(day, events);
            const outside = day.getMonth() !== month.getMonth();
            return (
              <div
                key={day.toISOString()}
                role="gridcell"
                tabIndex={0}
                className={`cal-day${outside ? " outside" : ""}${sameDay(day, today) ? " today" : ""}${sameDay(day, selected) ? " selected" : ""}`}
                onClick={() => setSelected(day)}
                onDoubleClick={() => setEditing(draftFor(null, day))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") setEditing(draftFor(null, day));
                }}
              >
                <span className="cal-num">{day.getDate()}</span>
                <div className="cal-chips">
                  {list.slice(0, 3).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`cal-chip${item.all_day ? " all-day" : ""}`}
                      style={{ ["--chip" as string]: item.color || "var(--accent)" }}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelected(day);
                        setEditing(draftFor(item, day));
                      }}
                      title={item.title}
                    >
                      {item.all_day ? null : <span className="cal-chip-time">{timeLabel(new Date(item.starts_at))}</span>}
                      <span className="cal-chip-title">{item.title}</span>
                    </button>
                  ))}
                  {list.length > 3 ? <span className="cal-more">+{list.length - 3} more</span> : null}
                </div>
              </div>
            );
          })}
        </div>
        <aside className="cal-agenda">
          <h2>{selected.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</h2>
          {dayEvents.length ? (
            <ul>
              {dayEvents.map((item) => (
                <li key={item.id}>
                  <button type="button" className="agenda-item" style={{ ["--chip" as string]: item.color || "var(--accent)" }} onClick={() => setEditing(draftFor(item, selected))}>
                    <span className="agenda-time">{item.all_day ? "All day" : `${timeLabel(new Date(item.starts_at))} – ${timeLabel(new Date(item.ends_at))}`}</span>
                    <strong>{item.title}</strong>
                    {item.location ? (
                      <span className="agenda-meta">
                        <MapPin size={12} /> {item.location}
                      </span>
                    ) : null}
                    {item.remind_minutes != null ? (
                      <span className="agenda-meta">
                        <Bell size={12} /> {ALERTS.find((alert) => alert.value === String(item.remind_minutes))?.label ?? `${item.remind_minutes} min before`}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={CalendarDays} title="Nothing scheduled" body="Double-click a day or use New event to add one.">
              <button type="button" className="btn primary-soft sm" onClick={() => setEditing(draftFor(null, selected))}>
                <Plus size={14} /> Add event
              </button>
            </Empty>
          )}
        </aside>
      </div>
      {editing ? (
        <EventEditor
          key={editing.id ?? "new"}
          draft={editing}
          onClose={() => setEditing(null)}
          onSave={(form) => void save(form)}
          onDelete={(id) => {
            void remove(id);
            setEditing(null);
          }}
        />
      ) : null}
    </section>
  );
}
