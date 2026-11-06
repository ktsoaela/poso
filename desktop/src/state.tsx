import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, ApiError, connectEngine, post, socketUrl } from "./api";
import { appInBackground, notify, onNotificationClick } from "./desktop";
import { forwardHtml, groupThreads, quoteHtml, replyAllTo, subjectWith, textToHtml } from "./format";
import type {
  Account,
  Bootstrap,
  ComposeState,
  Draft,
  Label,
  Mailbox,
  Message,
  MessageDetail,
  OutboxItem,
  Provider,
  QuickFilter,
  Session,
  Toast,
} from "./types";

function signInToast(message: string): string {
  if (/AUTHENTICATIONFAILED|Invalid credentials/i.test(message) && /gmail\.com/i.test(message)) {
    return "Gmail rejected that password. Use a 16-character app password from myaccount.google.com/apppasswords, and turn on IMAP in Gmail settings. Your Google account password will not work.";
  }
  return message;
}

export type BulkAction =
  | "archive"
  | "trash"
  | "inbox"
  | "spam"
  | "not_spam"
  | "read"
  | "unread"
  | "flag"
  | "unflag"
  | "delete_forever";

export type SettingsTab =
  | "general"
  | "accounts"
  | "sessions"
  | "labels"
  | "rules"
  | "spam"
  | "signin"
  | "data"
  | "audit"
  | "about";

export type AppView = "mail" | "calendar" | "people" | "tasks" | "notes" | "reminders";
export const APP_VIEWS: AppView[] = ["mail", "calendar", "people", "tasks", "notes", "reminders"];

/** An organizer item to open when its screen shows (from a notification click, palette, etc.). */
export interface FocusTarget {
  view: AppView;
  id: number;
}

/** Fired on `window` when the engine reports contacts/events/tasks/notes/reminders changed. */
export const ORGANIZER_EVENT = "session:organizer";

const LEAVES_VIEW: BulkAction[] = ["archive", "trash", "inbox", "spam", "not_spam", "delete_forever"];
const PAGE = 300;

interface MailValue {
  view: AppView;
  setView: (view: AppView) => void;
  focus: FocusTarget | null;
  openItem: (target: FocusTarget) => void;
  clearFocus: () => void;
  loading: boolean;
  error: string;
  connected: boolean;
  boot: Bootstrap | null;
  providers: Provider[];
  activeSession: Session | null;
  sessionAccounts: Account[];
  sessionLabels: Label[];
  mailbox: Mailbox;
  setMailbox: (mailbox: Mailbox) => void;
  mailboxTitle: string;
  query: string;
  setQuery: (query: string) => void;
  searchAll: boolean;
  setSearchAll: (value: boolean) => void;
  quick: QuickFilter;
  setQuick: (value: QuickFilter) => void;
  messages: Message[];
  rows: Message[];
  total: number;
  loadMore: () => void;
  listLoading: boolean;
  drafts: Draft[];
  outbox: OutboxItem[];
  selectedId: number | null;
  select: (id: number | null) => void;
  detail: MessageDetail | null;
  detailLoading: boolean;
  checked: Set<number>;
  toggleCheck: (id: number) => void;
  setChecked: (ids: Set<number>) => void;
  syncing: boolean;
  remoteAllowed: (id: number) => boolean;
  allowRemote: (id: number) => void;
  compose: ComposeState | null;
  sending: boolean;
  openCompose: (seed?: Partial<ComposeState>) => void;
  updateCompose: (patch: Partial<ComposeState>) => void;
  closeCompose: () => void;
  discardCompose: () => Promise<void>;
  send: (sendAt?: Date) => Promise<void>;
  reply: (all?: boolean) => void;
  forward: () => void;
  openDraft: (draft: Draft) => void;
  editScheduled: (item: OutboxItem) => Promise<void>;
  paletteOpen: boolean;
  setPaletteOpen: (value: boolean) => void;
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  helpOpen: boolean;
  setHelpOpen: (value: boolean) => void;
  toasts: Toast[];
  toast: (text: string, options?: Omit<Toast, "id" | "text">) => void;
  dismissToast: (id: number) => void;
  switchSession: (id: number) => Promise<void>;
  moveSelection: (delta: number) => void;
  targetIds: (explicit?: number[]) => number[];
  act: (action: BulkAction, ids?: number[]) => Promise<void>;
  labelMessages: (labelId: number, add: boolean, ids?: number[]) => Promise<void>;
  snoozeMessages: (until: Date | null, ids?: number[]) => Promise<void>;
  pinMessage: (id: number, pinned: boolean) => Promise<void>;
  emptyFolder: (role: "trash" | "spam") => Promise<void>;
  undoSpam: (id: number) => Promise<void>;
  syncNow: () => Promise<void>;
  createLabel: (name: string, color?: string) => Promise<Label | null>;
  seedDemo: () => Promise<boolean>;
  clearDemo: () => Promise<boolean>;
  addAccount: (body: Record<string, unknown>) => Promise<boolean>;
  updateAccount: (id: number, body: Record<string, unknown>) => Promise<void>;
  removeAccount: (id: number) => Promise<void>;
  saveSettings: (body: Record<string, unknown>) => Promise<void>;
  renameSession: (id: number, name: string, color?: string) => Promise<void>;
  createSession: (name: string) => Promise<void>;
  deleteSession: (id: number) => Promise<void>;
  startOAuth: (provider: string, sessionId?: number) => Promise<boolean>;
  reload: () => Promise<void>;
  run: (work: () => Promise<void>) => Promise<void>;
}

const MailContext = createContext<MailValue | null>(null);
let composeKey = 1;

function emptyCompose(accountId: number | null): ComposeState {
  return {
    key: composeKey++,
    accountId,
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    html: "",
    inReplyTo: "",
    references: [],
    replyToMessageId: null,
    draftId: null,
    showCc: false,
    files: [],
    priority: "normal",
    readReceipt: false,
    minimized: false,
    expanded: false,
  };
}

function signatureBlock(account: Account | undefined): string {
  if (!account?.signature) return "";
  return `<div data-signature="1">${account.signature}</div>`;
}

const ROLE_TITLES: Record<string, string> = {
  inbox: "Inbox",
  flagged: "Flagged",
  snoozed: "Snoozed",
  unread: "Unread",
  everything: "All mail",
  scheduled: "Scheduled",
  sent: "Sent",
  drafts: "Drafts",
  archive: "Archive",
  trash: "Trash",
  spam: "Spam",
};

export function MailProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [mailbox, setMailboxState] = useState<Mailbox>({ kind: "role", role: "inbox" });
  const [query, setQueryState] = useState("");
  const [debounced, setDebounced] = useState("");
  const [searchAll, setSearchAll] = useState(true);
  const [quick, setQuickState] = useState<QuickFilter>("all");
  const [messages, setMessages] = useState<Message[]>([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(PAGE);
  const [listLoading, setListLoading] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<MessageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [checked, setCheckedState] = useState<Set<number>>(new Set());
  const [syncingAccounts, setSyncingAccounts] = useState<Set<number>>(new Set());
  const [remoteIds, setRemoteIds] = useState<Set<number>>(new Set());
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [sending, setSending] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [helpOpen, setHelpOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [tick, setTick] = useState(0);
  const [view, setViewState] = useState<AppView>(() => {
    const saved = localStorage.getItem("session.view") as AppView | null;
    return saved && APP_VIEWS.includes(saved) ? saved : "mail";
  });
  const [focus, setFocus] = useState<FocusTarget | null>(null);
  const openTagRef = useRef<(tag: string) => void>(() => undefined);
  const bootRef = useRef<Bootstrap | null>(null);
  bootRef.current = boot;

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback((text: string, options: Omit<Toast, "id" | "text"> = {}) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [...current.slice(-3), { id, text, ...options }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), options.ttl ?? 6000);
  }, []);

  const setView = useCallback((next: AppView) => {
    setViewState(next);
    localStorage.setItem("session.view", next);
  }, []);

  const openItem = useCallback(
    (target: FocusTarget) => {
      setView(target.view);
      setFocus(target);
    },
    [setView],
  );

  const clearFocus = useCallback(() => setFocus(null), []);

  const run = useCallback(
    async (work: () => Promise<void>) => {
      try {
        await work();
      } catch (err) {
        toast(err instanceof ApiError || err instanceof Error ? err.message : "That didn't work.", { tone: "error" });
      }
    },
    [toast],
  );

  const reload = useCallback(async () => {
    const data = await api<Bootstrap>("/api/bootstrap");
    setBoot(data);
    setTick((value) => value + 1);
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        await connectEngine();
        const [data, preset] = await Promise.all([api<Bootstrap>("/api/bootstrap"), api<Provider[]>("/api/providers")]);
        if (!live) return;
        setBoot(data);
        setProviders(preset);
        setConnected(true);
      } catch (err) {
        if (live) setError(err instanceof Error ? err.message : "Poso couldn't open the mailbox.");
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  // Theme, density, and accent live on <html> so CSS variables cascade everywhere.
  useEffect(() => {
    const settings = boot?.settings;
    const apply = () => {
      const theme = settings?.theme ?? "system";
      const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      const root = document.documentElement;
      root.dataset.theme = dark ? "dark" : "light";
      root.dataset.density = settings?.density ?? "comfortable";
      root.dataset.accent = settings?.accent ?? "indigo";
    };
    apply();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [boot?.settings]);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(query), 220);
    return () => window.clearTimeout(handle);
  }, [query]);

  const activeId = boot?.active_session_id ?? null;

  // Message list.
  useEffect(() => {
    if (!activeId) return;
    if (mailbox.kind === "role" && (mailbox.role === "drafts" || mailbox.role === "scheduled") && !debounced.trim()) {
      setMessages([]);
      setTotal(0);
      return;
    }
    let live = true;
    const params = new URLSearchParams({ session_id: String(activeId), limit: String(limit) });
    const searching = Boolean(debounced.trim());
    const scoped = !searching || !searchAll;
    if (scoped) {
      if (mailbox.kind === "role" && mailbox.role !== "drafts" && mailbox.role !== "scheduled") params.set("folder_role", mailbox.role);
      if (mailbox.kind === "role" && mailbox.accountId) params.set("account_id", String(mailbox.accountId));
      if (mailbox.kind === "folder") params.set("folder_id", String(mailbox.folderId));
      if (mailbox.kind === "label") params.set("label_id", String(mailbox.labelId));
    } else {
      params.set("folder_role", "everything");
    }
    const extra = { all: "", unread: "is:unread", flagged: "is:flagged", attachments: "has:attachment" }[quick];
    const q = [debounced.trim(), extra].filter(Boolean).join(" ");
    if (q) params.set("q", q);
    setListLoading(true);
    api<{ messages: Message[]; total: number }>(`/api/messages?${params}`)
      .then((data) => {
        if (!live) return;
        setMessages(data.messages);
        setTotal(data.total);
      })
      .catch((err: unknown) => {
        if (live) toast(err instanceof Error ? err.message : "Couldn't load mail.", { tone: "error" });
      })
      .finally(() => {
        if (live) setListLoading(false);
      });
    return () => {
      live = false;
    };
  }, [activeId, mailbox, debounced, searchAll, quick, limit, tick, toast]);

  // Drafts and scheduled mail (also used for sidebar counts).
  useEffect(() => {
    if (!activeId) return;
    let live = true;
    api<{ drafts: Draft[] }>(`/api/drafts?session_id=${activeId}`)
      .then((data) => live && setDrafts(data.drafts))
      .catch(() => live && setDrafts([]));
    api<{ items: OutboxItem[] }>(`/api/outbox?session_id=${activeId}`)
      .then((data) => live && setOutbox(data.items))
      .catch(() => live && setOutbox([]));
    return () => {
      live = false;
    };
  }, [activeId, tick]);

  // Live updates from the engine.
  useEffect(() => {
    if (!activeId) return;
    let socket: WebSocket | null = null;
    let stopped = false;
    let timer = 0;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void reload().catch(() => undefined), 300);
    };
    const connect = () => {
      socket = new WebSocket(socketUrl());
      socket.onopen = () => setConnected(true);
      socket.onmessage = (event) => {
        const data = JSON.parse(String(event.data)) as {
          type?: string;
          subject?: string;
          message_id?: number;
          message_ids?: number[];
          session_id?: number;
          account_id?: number;
          error?: string;
          kind?: string;
          id?: number;
          title?: string;
          body?: string;
        };
        if (data.type === "organizer.changed") {
          window.dispatchEvent(new CustomEvent(ORGANIZER_EVENT, { detail: data.kind }));
        }
        if (data.type === "reminder.due" && data.id) {
          const view: AppView = data.kind === "event" ? "calendar" : data.kind === "task" ? "tasks" : "reminders";
          const tag = `${view}:${data.session_id ?? 0}:${data.id}`;
          const title = data.title || "Reminder";
          void notify({ title, body: data.body || "", tag, urgent: data.kind === "reminder" });
          toast(`${data.kind === "event" ? "Coming up" : data.kind === "task" ? "Due now" : "Reminder"}: ${title}`, {
            ttl: 12000,
            action: { label: "Open", run: () => openTagRef.current(tag) },
          });
        }
        if (data.type === "sync.start" && data.account_id) {
          setSyncingAccounts((current) => new Set(current).add(data.account_id as number));
        }
        if (data.type === "sync.done" || data.type === "sync.error") {
          setSyncingAccounts((current) => {
            const next = new Set(current);
            next.delete(data.account_id as number);
            return next;
          });
          refresh();
        }
        if (data.type === "mail.new" || data.type === "mail.sent") {
          refresh();
          const settings = bootRef.current?.settings;
          if (data.type === "mail.new" && settings?.notify && appInBackground()) {
            const count = data.message_ids?.length ?? 1;
            const first = data.message_ids?.[0];
            void notify({
              title: count > 1 ? `${count} new messages` : "New message",
              body: data.subject || "Poso has new mail",
              tag: count === 1 && first ? `mail:${data.session_id ?? 0}:${first}` : `mail:${data.session_id ?? 0}:0`,
            });
          }
          if (data.type === "mail.sent") toast(`Scheduled message sent: ${data.subject || "(no subject)"}`, { tone: "success" });
        }
        if (data.type === "spam.auto" && data.message_id && data.session_id === bootRef.current?.active_session_id) {
          const id = data.message_id;
          toast(`Filed “${data.subject || "a message"}” as spam`, {
            action: { label: "Undo", run: () => void post(`/api/messages/${id}/spam/undo`).then(refresh) },
          });
        }
      };
      socket.onclose = () => {
        setConnected(false);
        if (!stopped) window.setTimeout(connect, 1600);
      };
    };
    connect();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      socket?.close();
    };
  }, [activeId, reload, toast]);

  const conversations = boot?.settings.conversations ?? true;
  const rows = useMemo(() => {
    const grouped = conversations && !(mailbox.kind === "role" && (mailbox.role === "spam" || mailbox.role === "trash"));
    return grouped ? groupThreads(messages) : messages.map((item) => ({ ...item, threadIds: [item.id], threadUnread: !item.seen }));
  }, [messages, conversations, mailbox]);

  // Keep the open message valid when the list changes.
  useEffect(() => {
    if (selectedId == null) return;
    if (messages.some((item) => item.id === selectedId)) return;
    if (detail && detail.id === selectedId && detail.thread.some((item) => item.id === selectedId)) return;
    setSelectedId(null);
  }, [messages, selectedId, detail]);

  const reloadBootOnly = useCallback(async () => {
    try {
      setBoot(await api<Bootstrap>("/api/bootstrap"));
    } catch {
      /* the next refresh will retry */
    }
  }, []);

  // Message detail; opening marks it read.
  useEffect(() => {
    if (selectedId == null) {
      setDetail(null);
      return;
    }
    let live = true;
    setDetailLoading(true);
    api<MessageDetail>(`/api/messages/${selectedId}`)
      .then(async (data) => {
        if (!live) return;
        setDetail(data);
        if (!data.seen) {
          const updated = await post<MessageDetail>(`/api/messages/${selectedId}/flags`, { seen: true });
          if (!live) return;
          setDetail(updated);
          setMessages((current) => current.map((item) => (item.id === updated.id ? { ...item, seen: true } : item)));
          void reloadBootOnly();
        }
      })
      .catch((err: unknown) => {
        if (live) toast(err instanceof Error ? err.message : "Couldn't open that message.", { tone: "error" });
      })
      .finally(() => {
        if (live) setDetailLoading(false);
      });
    return () => {
      live = false;
    };
  }, [selectedId, toast, reloadBootOnly]);

  // Draft autosave.
  useEffect(() => {
    if (!compose || sending || !compose.accountId) return;
    if (!compose.to && !compose.subject && !compose.html.replace(/<[^>]+>|&nbsp;|\s/g, "")) return;
    const snapshot = compose;
    const handle = window.setTimeout(() => {
      api<Draft>("/api/drafts", {
        method: "PUT",
        body: JSON.stringify({
          id: snapshot.draftId,
          account_id: snapshot.accountId,
          to: snapshot.to,
          cc: snapshot.cc,
          bcc: snapshot.bcc,
          subject: snapshot.subject,
          body_html: snapshot.html,
          in_reply_to: snapshot.inReplyTo,
          references: snapshot.references,
          reply_to_message_id: snapshot.replyToMessageId,
        }),
      })
        .then((draft) => {
          setCompose((current) => (current && current.key === snapshot.key && current.draftId !== draft.id ? { ...current, draftId: draft.id } : current));
        })
        .catch(() => undefined);
    }, 900);
    return () => window.clearTimeout(handle);
  }, [compose, sending]);

  const activeSession = useMemo(() => boot?.sessions.find((item) => item.id === boot.active_session_id) ?? null, [boot]);
  const sessionAccounts = useMemo(
    () => (boot ? boot.accounts.filter((account) => account.session_id === boot.active_session_id) : []),
    [boot],
  );
  const sessionLabels = useMemo(
    () => (boot ? boot.labels.filter((label) => label.session_id === boot.active_session_id) : []),
    [boot],
  );

  const mailboxTitle = useMemo(() => {
    if (debounced.trim() && searchAll) return "Search results";
    if (mailbox.kind === "role") {
      const base = ROLE_TITLES[mailbox.role] ?? mailbox.role;
      const account = mailbox.accountId ? boot?.accounts.find((item) => item.id === mailbox.accountId) : null;
      return account ? `${base} · ${account.email}` : base;
    }
    if (mailbox.kind === "label") return boot?.labels.find((item) => item.id === mailbox.labelId)?.name ?? "Label";
    const folder = boot?.folders.find((item) => item.id === mailbox.folderId);
    return folder ? folder.imap_name : "Folder";
  }, [mailbox, boot, debounced, searchAll]);

  const setMailbox = useCallback((next: Mailbox) => {
    setMailboxState(next);
    setView("mail");
    setSelectedId(null);
    setCheckedState(new Set());
    setLimit(PAGE);
    setQueryState("");
    setDebounced("");
    setQuickState("all");
  }, [setView]);

  const setQuery = useCallback(
    (value: string) => {
      setQueryState(value);
      setCheckedState(new Set());
      if (value.trim()) setView("mail");
    },
    [setView],
  );

  const setQuick = useCallback((value: QuickFilter) => {
    setQuickState(value);
    setCheckedState(new Set());
  }, []);

  const switchSession = useCallback(async (id: number) => {
    const data = await api<Bootstrap>("/api/settings", { method: "PATCH", body: JSON.stringify({ active_session_id: id }) });
    setBoot(data);
    setMailboxState({ kind: "role", role: "inbox" });
    setQueryState("");
    setDebounced("");
    setQuickState("all");
    setSelectedId(null);
    setCheckedState(new Set());
    setCompose(null);
    setPaletteOpen(false);
    setLimit(PAGE);
  }, []);

  // Notification clicks land here as "<view>:<session id>:<item id>".
  const openTag = useCallback(
    async (tag: string) => {
      const [kind, sessionText, idText] = tag.split(":");
      const sessionId = Number(sessionText);
      const id = Number(idText);
      if (!APP_VIEWS.includes(kind as AppView)) return;
      if (sessionId && bootRef.current && sessionId !== bootRef.current.active_session_id) {
        await switchSession(sessionId).catch(() => undefined);
      }
      if (kind === "mail") {
        setView("mail");
        if (id) setSelectedId(id);
        return;
      }
      if (id) openItem({ view: kind as AppView, id });
      else setView(kind as AppView);
    },
    [switchSession, setView, openItem],
  );
  openTagRef.current = (tag) => void openTag(tag);

  useEffect(() => onNotificationClick((tag) => openTagRef.current(tag)), []);

  const moveSelection = useCallback(
    (delta: number) => {
      if (!rows.length) return;
      const index = rows.findIndex((item) => item.id === selectedId || item.threadIds?.includes(selectedId ?? -1));
      const next = rows[Math.min(rows.length - 1, Math.max(0, index < 0 ? 0 : index + delta))];
      if (next) setSelectedId(next.id);
    },
    [rows, selectedId],
  );

  const toggleCheck = useCallback((id: number) => {
    setCheckedState((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Rows stand for whole conversations; expand to every message of the thread in this view.
  const targetIds = useCallback(
    (explicit?: number[]) => {
      const base = explicit ?? (checked.size ? [...checked] : selectedId != null ? [selectedId] : []);
      const ids = new Set<number>();
      for (const id of base) {
        const row = rows.find((item) => item.id === id || item.threadIds?.includes(id));
        (row?.threadIds ?? [id]).forEach((value) => ids.add(value));
        ids.add(id);
      }
      return [...ids];
    },
    [checked, selectedId, rows],
  );

  const advanceFrom = useCallback(
    (removed: Set<number>) => {
      if (selectedId == null || !removed.has(selectedId)) return;
      const index = rows.findIndex((item) => item.threadIds?.includes(selectedId));
      const rest = rows.filter((item) => !(item.threadIds ?? [item.id]).some((id) => removed.has(id)));
      const next = rest[Math.min(Math.max(index, 0), rest.length - 1)];
      setSelectedId(next ? next.id : null);
    },
    [rows, selectedId],
  );

  const act = useCallback(
    async (action: BulkAction, explicit?: number[]) => {
      const ids = targetIds(explicit);
      if (!ids.length) return;
      const before = new Map(messages.filter((item) => ids.includes(item.id)).map((item) => [item.id, item.folder_role]));
      const removed = new Set(ids);
      if (LEAVES_VIEW.includes(action)) {
        advanceFrom(removed);
        setMessages((current) => current.filter((item) => !removed.has(item.id)));
      } else {
        setMessages((current) =>
          current.map((item) =>
            removed.has(item.id)
              ? {
                  ...item,
                  seen: action === "read" ? true : action === "unread" ? false : item.seen,
                  flagged: action === "flag" ? true : action === "unflag" ? false : item.flagged,
                }
              : item,
          ),
        );
        if (detail && removed.has(detail.id)) {
          setDetail({
            ...detail,
            seen: action === "read" ? true : action === "unread" ? false : detail.seen,
            flagged: action === "flag" ? true : action === "unflag" ? false : detail.flagged,
          });
        }
      }
      setCheckedState(new Set());
      try {
        const result = await post<{ done: number; errors: string[] }>("/api/bulk", { ids, action });
        if (result.errors.length) toast(result.errors[0], { tone: "error" });
        const words: Partial<Record<BulkAction, string>> = {
          archive: "Archived",
          trash: "Moved to Trash",
          inbox: "Moved to Inbox",
          spam: "Reported as spam",
          not_spam: "Moved to Inbox — sender allowlisted",
          delete_forever: "Deleted forever",
        };
        const label = words[action];
        if (label) {
          const count = result.done;
          const undoable = action === "archive" || action === "trash" || action === "inbox";
          toast(`${label}${count > 1 ? ` · ${count} messages` : ""}`, {
            action: undoable
              ? {
                  label: "Undo",
                  run: () =>
                    void (async () => {
                      for (const [id, role] of before) {
                        await post(`/api/messages/${id}/move`, { role }).catch(() => undefined);
                      }
                      await reload();
                    })(),
                }
              : undefined,
          });
        }
        await reload();
      } catch (err) {
        toast(err instanceof Error ? err.message : "That didn't work.", { tone: "error" });
        await reload();
      }
    },
    [targetIds, messages, advanceFrom, detail, toast, reload],
  );

  const labelMessages = useCallback(
    async (labelId: number, add: boolean, explicit?: number[]) => {
      const ids = targetIds(explicit);
      if (!ids.length) return;
      await run(async () => {
        await post("/api/bulk", { ids, action: add ? "label" : "unlabel", label_id: labelId });
        if (detail && ids.includes(detail.id)) {
          setDetail({ ...detail, labels: add ? [...new Set([...detail.labels, labelId])] : detail.labels.filter((item) => item !== labelId) });
        }
        await reload();
      });
    },
    [targetIds, run, detail, reload],
  );

  const snoozeMessages = useCallback(
    async (until: Date | null, explicit?: number[]) => {
      const ids = targetIds(explicit);
      if (!ids.length) return;
      await run(async () => {
        if (until) {
          await post("/api/bulk", { ids, action: "snooze", until: until.toISOString() });
          const removed = new Set(ids);
          advanceFrom(removed);
          setMessages((current) => current.filter((item) => !removed.has(item.id)));
          toast(`Snoozed until ${until.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`, {
            action: {
              label: "Undo",
              run: () => void post("/api/bulk", { ids, action: "snooze", until: null }).then(() => reload()),
            },
          });
        } else {
          await post("/api/bulk", { ids, action: "snooze", until: null });
          toast("Unsnoozed — back in the inbox");
        }
        setCheckedState(new Set());
        await reload();
      });
    },
    [targetIds, run, advanceFrom, toast, reload],
  );

  const pinMessage = useCallback(
    async (id: number, pinned: boolean) => {
      await run(async () => {
        const updated = await post<MessageDetail>(`/api/messages/${id}/pin`, { pinned });
        if (detail?.id === id) setDetail(updated);
        await reload();
      });
    },
    [run, detail, reload],
  );

  const emptyFolder = useCallback(
    async (role: "trash" | "spam") => {
      if (!activeId) return;
      await run(async () => {
        const result = await post<{ deleted: number }>("/api/folders/empty", { session_id: activeId, role });
        setSelectedId(null);
        toast(`Deleted ${result.deleted} message${result.deleted === 1 ? "" : "s"} forever`);
        await reload();
      });
    },
    [activeId, run, toast, reload],
  );

  const undoSpam = useCallback(
    async (id: number) => {
      await run(async () => {
        await post(`/api/messages/${id}/spam/undo`);
        await reload();
      });
    },
    [run, reload],
  );

  const openCompose = useCallback(
    (seed?: Partial<ComposeState>) => {
      const accountId = seed?.accountId ?? (mailbox.kind === "role" ? mailbox.accountId : undefined) ?? sessionAccounts[0]?.id ?? null;
      const account = sessionAccounts.find((item) => item.id === accountId);
      const base = emptyCompose(accountId);
      const html = seed?.html ?? `<p><br></p>${signatureBlock(account) ? `<p><br></p>${signatureBlock(account)}` : ""}`;
      setCompose({ ...base, ...seed, html, accountId, key: base.key });
    },
    [sessionAccounts, mailbox],
  );

  const updateCompose = useCallback((patch: Partial<ComposeState>) => {
    setCompose((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const closeCompose = useCallback(() => {
    setCompose(null);
    setTick((value) => value + 1);
  }, []);

  const discardCompose = useCallback(async () => {
    const current = compose;
    setCompose(null);
    if (current?.draftId) {
      await api(`/api/drafts/${current.draftId}`, { method: "DELETE" }).catch(() => undefined);
    }
    toast("Draft discarded");
    setTick((value) => value + 1);
  }, [compose, toast]);

  const reply = useCallback(
    (all = false) => {
      if (!detail) return;
      const account = sessionAccounts.find((item) => item.id === detail.account_id);
      const sig = signatureBlock(account);
      const cc = all
        ? detail.cc.map((item) => item.email).filter((email) => email.toLowerCase() !== detail.account_email.toLowerCase()).join(", ")
        : "";
      const to = all
        ? replyAllTo({ ...detail, cc: [] }, detail.account_email)
        : detail.folder_role === "sent"
          ? detail.to.map((item) => item.email).join(", ")
          : detail.from_email;
      openCompose({
        accountId: detail.account_id,
        to,
        cc,
        showCc: Boolean(cc),
        subject: subjectWith("Re:", detail.subject),
        html: `<p><br></p>${sig ? `<p><br></p>${sig}` : ""}${quoteHtml(detail)}`,
        inReplyTo: detail.message_id,
        references: [...detail.references, detail.message_id].filter(Boolean),
        replyToMessageId: detail.id,
      });
    },
    [detail, openCompose, sessionAccounts],
  );

  const forward = useCallback(() => {
    if (!detail) return;
    const account = sessionAccounts.find((item) => item.id === detail.account_id);
    const sig = signatureBlock(account);
    openCompose({
      accountId: detail.account_id,
      subject: subjectWith("Fwd:", detail.subject),
      html: `<p><br></p>${sig ? `<p><br></p>${sig}` : ""}${forwardHtml(detail)}`,
    });
  }, [detail, openCompose, sessionAccounts]);

  const pendingSend = useRef<number | null>(null);

  const deliver = useCallback(
    async (draft: ComposeState, sendAt?: Date) => {
      setSending(true);
      try {
        const result = await post<{ scheduled?: boolean; send_at?: string }>("/api/send", {
          account_id: draft.accountId,
          to: draft.to,
          cc: draft.cc,
          bcc: draft.bcc,
          subject: draft.subject,
          body_html: draft.html,
          in_reply_to: draft.inReplyTo,
          references: draft.references,
          reply_to_message_id: draft.replyToMessageId,
          draft_id: draft.draftId,
          attachments: draft.files.map(({ filename, content_type, data_base64 }) => ({ filename, content_type, data_base64 })),
          priority: draft.priority,
          read_receipt: draft.readReceipt,
          send_at: sendAt ? sendAt.toISOString() : null,
        });
        if (result?.scheduled) {
          toast(`Scheduled for ${new Date(result.send_at as string).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`, { tone: "success" });
        } else {
          toast("Message sent", { tone: "success" });
        }
        await reload();
      } catch (err) {
        toast(err instanceof Error ? err.message : "Couldn't send.", { tone: "error", ttl: 9000 });
        setCompose({ ...draft, minimized: false });
      } finally {
        setSending(false);
      }
    },
    [toast, reload],
  );

  const send = useCallback(
    async (sendAt?: Date) => {
      if (!compose?.accountId) return;
      if (!compose.to.trim() && !compose.cc.trim() && !compose.bcc.trim()) {
        toast("Add at least one recipient.", { tone: "error" });
        return;
      }
      const invalid = [compose.to, compose.cc, compose.bcc]
        .flatMap((field) => field.split(/[,;]/))
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => (/<([^>]+)>/.exec(item)?.[1] ?? item).trim())
        .find((email) => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email));
      if (invalid) {
        toast(`“${invalid}” isn't a valid email address.`, { tone: "error" });
        return;
      }
      const draft = compose;
      setCompose(null);
      const delay = sendAt ? 0 : (boot?.settings.undo_send_seconds ?? 0);
      if (delay <= 0) {
        await deliver(draft, sendAt);
        return;
      }
      const id = Date.now();
      setToasts((current) => [
        ...current,
        {
          id,
          text: "Sending…",
          action: {
            label: "Undo",
            run: () => {
              if (pendingSend.current) window.clearTimeout(pendingSend.current);
              pendingSend.current = null;
              setCompose({ ...draft, minimized: false });
            },
          },
        },
      ]);
      pendingSend.current = window.setTimeout(() => {
        pendingSend.current = null;
        setToasts((current) => current.filter((item) => item.id !== id));
        void deliver(draft);
      }, delay * 1000);
      window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), delay * 1000);
    },
    [compose, boot?.settings.undo_send_seconds, deliver, toast],
  );

  const openDraft = useCallback(
    (draft: Draft) => {
      const html = /<[a-z][\s\S]*>/i.test(draft.body) ? draft.body : textToHtml(draft.body);
      openCompose({
        accountId: draft.account_id,
        to: draft.to,
        cc: draft.cc,
        bcc: draft.bcc,
        subject: draft.subject,
        html,
        inReplyTo: draft.in_reply_to,
        references: draft.references,
        replyToMessageId: draft.reply_to_message_id,
        draftId: draft.id,
        showCc: Boolean(draft.cc || draft.bcc),
      });
    },
    [openCompose],
  );

  const editScheduled = useCallback(
    async (item: OutboxItem) => {
      await run(async () => {
        const removed = await api<OutboxItem>(`/api/outbox/${item.id}`, { method: "DELETE" });
        const payload = removed.payload as Record<string, unknown>;
        openCompose({
          accountId: Number(payload.account_id),
          to: String(payload.to ?? ""),
          cc: String(payload.cc ?? ""),
          bcc: String(payload.bcc ?? ""),
          subject: String(payload.subject ?? ""),
          html: String(payload.body_html || textToHtml(String(payload.body ?? ""))),
          showCc: Boolean(payload.cc || payload.bcc),
        });
        toast("Scheduled send cancelled — edit and send again");
        await reload();
      });
    },
    [run, openCompose, toast, reload],
  );

  const syncNow = useCallback(async () => {
    await run(async () => {
      const accounts = sessionAccounts.filter((item) => item.auth_type !== "local");
      if (!accounts.length) {
        toast("Sample accounts don't sync. Add a real account to fetch mail.");
        await reload();
        return;
      }
      await Promise.all(accounts.map((item) => post(`/api/accounts/${item.id}/sync`)));
      toast(`Checking ${accounts.length} account${accounts.length === 1 ? "" : "s"} for new mail…`);
    });
  }, [run, sessionAccounts, toast, reload]);

  const createLabel = useCallback(
    async (name: string, color?: string) => {
      if (!activeId) return null;
      try {
        const label = await post<Label>("/api/labels", { session_id: activeId, name, color: color ?? "" });
        await reload();
        return label;
      } catch (err) {
        toast(err instanceof Error ? err.message : "Couldn't create that label.", { tone: "error" });
        return null;
      }
    },
    [activeId, reload, toast],
  );

  const value: MailValue = {
    view,
    setView,
    focus,
    openItem,
    clearFocus,
    loading,
    error,
    connected,
    boot,
    providers,
    activeSession,
    sessionAccounts,
    sessionLabels,
    mailbox,
    setMailbox,
    mailboxTitle,
    query,
    setQuery,
    searchAll,
    setSearchAll,
    quick,
    setQuick,
    messages,
    rows,
    total,
    loadMore: () => setLimit((value) => value + PAGE),
    listLoading,
    drafts,
    outbox,
    selectedId,
    select: setSelectedId,
    detail,
    detailLoading,
    checked,
    toggleCheck,
    setChecked: setCheckedState,
    syncing: syncingAccounts.size > 0,
    remoteAllowed: (id) => Boolean(boot?.settings.load_remote_images) || remoteIds.has(id),
    allowRemote: (id) => setRemoteIds((current) => new Set(current).add(id)),
    compose,
    sending,
    openCompose,
    updateCompose,
    closeCompose,
    discardCompose,
    send,
    reply,
    forward,
    openDraft,
    editScheduled,
    paletteOpen,
    setPaletteOpen,
    settingsOpen,
    settingsTab,
    openSettings: (tab) => {
      if (tab) setSettingsTab(tab);
      setSettingsOpen(true);
      setPaletteOpen(false);
    },
    closeSettings: () => setSettingsOpen(false),
    helpOpen,
    setHelpOpen,
    toasts,
    toast,
    dismissToast,
    switchSession: (id) => run(() => switchSession(id)),
    moveSelection,
    targetIds,
    act,
    labelMessages,
    snoozeMessages,
    pinMessage,
    emptyFolder,
    undoSpam,
    syncNow,
    createLabel,
    seedDemo: async () => {
      try {
        await post("/api/demo/seed");
        await reload();
        return true;
      } catch (err) {
        toast(err instanceof Error ? err.message : "Sample mail could not be added.", { tone: "error" });
        return false;
      }
    },
    clearDemo: async () => {
      try {
        await post("/api/demo/clear");
        await reload();
        toast("Sample mail removed. Your accounts and their audit history are unchanged.", { tone: "success" });
        return true;
      } catch (err) {
        toast(err instanceof Error ? err.message : "Sample mail could not be removed.", { tone: "error", ttl: 9000 });
        return false;
      }
    },
    addAccount: async (body) => {
      try {
        await post("/api/accounts", body);
        await reload();
        toast("Account added — syncing now", { tone: "success" });
        return true;
      } catch (err) {
        toast(signInToast(err instanceof Error ? err.message : "Couldn't add that account."), { tone: "error", ttl: 12000 });
        return false;
      }
    },
    updateAccount: (id, body) =>
      run(async () => {
        await api(`/api/accounts/${id}`, { method: "PATCH", body: JSON.stringify(body) });
        await reload();
      }),
    removeAccount: (id) =>
      run(async () => {
        await api(`/api/accounts/${id}`, { method: "DELETE" });
        await reload();
        toast("Account removed");
      }),
    saveSettings: (body) =>
      run(async () => {
        setBoot(await api<Bootstrap>("/api/settings", { method: "PATCH", body: JSON.stringify(body) }));
        setTick((value) => value + 1);
      }),
    renameSession: (id, name, color) =>
      run(async () => {
        await api(`/api/sessions/${id}`, { method: "PATCH", body: JSON.stringify({ name, color }) });
        await reload();
      }),
    createSession: (name) =>
      run(async () => {
        await post("/api/sessions", { name });
        await reload();
        toast(`Session “${name}” created`, { tone: "success" });
      }),
    deleteSession: (id) =>
      run(async () => {
        await api(`/api/sessions/${id}`, { method: "DELETE" });
        await reload();
      }),
    startOAuth: async (provider, sessionId) => {
      if (!boot) return false;
      const missing = provider === "google" ? !boot.oauth.google_client_id : provider === "microsoft" ? !boot.oauth.microsoft_client_id : false;
      if (missing) {
        setSettingsTab("signin");
        setSettingsOpen(true);
        setPaletteOpen(false);
        const label = provider === "google" ? "Google" : "Microsoft";
        toast(`Paste a ${label} client id under Sign-in apps and save it, then try Sign in again.`, { tone: "error", ttl: 12000 });
        return false;
      }
      try {
        toast("Finish signing in in your browser…", { ttl: 12000 });
        await post("/api/oauth/start", { provider, session_id: sessionId ?? boot.active_session_id });
        await reload();
        toast("Account connected", { tone: "success" });
        return true;
      } catch (err) {
        toast(signInToast(err instanceof Error ? err.message : "Couldn't sign in."), { tone: "error", ttl: 12000 });
        return false;
      }
    },
    reload,
    run,
  };

  return <MailContext.Provider value={value}>{children}</MailContext.Provider>;
}

export function useMail(): MailValue {
  const value = useContext(MailContext);
  if (!value) throw new Error("useMail must be used inside MailProvider");
  return value;
}
