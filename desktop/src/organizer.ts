import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { ORGANIZER_EVENT, useMail } from "./state";

export interface Person {
  id: number;
  session_id: number;
  name: string;
  email: string;
  phone: string;
  company: string;
  title: string;
  address: string;
  birthday: string;
  notes: string;
  favorite: boolean;
  updated_at: string | null;
}

export interface CalendarEvent {
  id: number;
  session_id: number;
  title: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location: string;
  notes: string;
  color: string;
  remind_minutes: number | null;
  updated_at: string | null;
}

export interface Task {
  id: number;
  session_id: number;
  title: string;
  notes: string;
  due_at: string | null;
  important: boolean;
  done: boolean;
  done_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface Note {
  id: number;
  session_id: number;
  title: string;
  body: string;
  color: string;
  pinned: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export type Repeat = "none" | "daily" | "weekdays" | "weekly" | "monthly" | "yearly";

export interface Reminder {
  id: number;
  session_id: number;
  title: string;
  notes: string;
  remind_at: string;
  repeat: Repeat;
  done: boolean;
  fired_at: string | null;
  updated_at: string | null;
}

/** API path segment → item type. The engine stores people as "contacts". */
export interface Kinds {
  people: Person;
  events: CalendarEvent;
  tasks: Task;
  notes: Note;
  reminders: Reminder;
}

export type Kind = keyof Kinds;

const ENGINE_KIND: Record<Kind, string> = { people: "contacts", events: "events", tasks: "tasks", notes: "notes", reminders: "reminders" };

/**
 * Loads one kind of organizer item for the active session and keeps it fresh when the engine
 * broadcasts a change. Writes update local state optimistically from the server's reply.
 */
export function useItems<K extends Kind>(kind: K, params: Record<string, string> = {}) {
  type Item = Kinds[K];
  const { boot, toast } = useMail();
  const sessionId = boot?.active_session_id ?? null;
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const query = new URLSearchParams(params).toString();
  const version = useRef(0);

  const load = useCallback(async () => {
    if (!sessionId) return;
    const mine = ++version.current;
    try {
      const search = new URLSearchParams(query);
      search.set("session_id", String(sessionId));
      const data = await api<{ items: Item[] }>(`/api/${kind}?${search}`);
      if (mine === version.current) setItems(data.items);
    } catch (err) {
      if (mine === version.current) toast(err instanceof Error ? err.message : "Couldn't load items.", { tone: "error" });
    } finally {
      if (mine === version.current) setLoading(false);
    }
  }, [kind, sessionId, query, toast]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    let timer = 0;
    const onChange = (event: Event) => {
      const changed = (event as CustomEvent<string | undefined>).detail;
      if (changed && changed !== ENGINE_KIND[kind]) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(), 150);
    };
    window.addEventListener(ORGANIZER_EVENT, onChange);
    return () => {
      window.removeEventListener(ORGANIZER_EVENT, onChange);
      window.clearTimeout(timer);
    };
  }, [kind, load]);

  const guard = useCallback(
    async <T,>(work: () => Promise<T>): Promise<T | null> => {
      try {
        return await work();
      } catch (err) {
        toast(err instanceof Error ? err.message : "That didn't work.", { tone: "error" });
        return null;
      }
    },
    [toast],
  );

  const create = useCallback(
    (body: Partial<Item>) =>
      guard(async () => {
        const item = await api<Item>(`/api/${kind}`, { method: "POST", body: JSON.stringify({ ...body, session_id: sessionId }) });
        setItems((current) => [...current, item]);
        return item;
      }),
    [guard, kind, sessionId],
  );

  const update = useCallback(
    (id: number, patch: Partial<Item>) =>
      guard(async () => {
        setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
        const item = await api<Item>(`/api/${kind}/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
        setItems((current) => current.map((row) => (row.id === id ? item : row)));
        return item;
      }),
    [guard, kind],
  );

  const remove = useCallback(
    (id: number) =>
      guard(async () => {
        setItems((current) => current.filter((item) => item.id !== id));
        await api(`/api/${kind}/${id}`, { method: "DELETE" });
        return true;
      }),
    [guard, kind],
  );

  return { items, setItems, loading, reload: load, create, update, remove, sessionId };
}

// ---------- date helpers shared by the organizer screens ----------

export function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Local `YYYY-MM-DD` for <input type="date">. */
export function toDateInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local `HH:MM` for <input type="time">. */
export function toTimeInput(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Local `YYYY-MM-DDTHH:MM` for <input type="datetime-local">. */
export function toLocalInput(date: Date): string {
  return `${toDateInput(date)}T${toTimeInput(date)}`;
}

/** Parses a local date (and optional time) from form inputs into a Date. */
export function fromInputs(date: string, time = "00:00"): Date | null {
  if (!date) return null;
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time || "00:00").split(":").map(Number);
  const value = new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0);
  return Number.isNaN(value.getTime()) ? null : value;
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function timeLabel(date: Date): string {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** "Today 3:00 PM", "Tomorrow 9:00 AM", "Fri 12 Dec 9:00 AM". */
export function whenLabel(iso: string | null, withTime = true): string {
  if (!iso) return "";
  const date = new Date(iso);
  const today = startOfDay(new Date());
  const day = startOfDay(date);
  const diff = Math.round((day.getTime() - today.getTime()) / 86400000);
  const name =
    diff === 0
      ? "Today"
      : diff === 1
        ? "Tomorrow"
        : diff === -1
          ? "Yesterday"
          : date.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
  return withTime ? `${name} ${timeLabel(date)}` : name;
}

export const EVENT_COLORS = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#64748b"];
