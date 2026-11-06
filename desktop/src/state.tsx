import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, ApiError, connectEngine, socketUrl } from "./api";
import { groupThreads, quoteBody, replyAllTo, subjectWith } from "./format";
import type {
  Account,
  Bootstrap,
  ComposeState,
  Draft,
  Mailbox,
  Message,
  MessageDetail,
  Provider,
  Toast,
} from "./types";

interface MailValue {
  loading: boolean;
  error: string;
  boot: Bootstrap | null;
  providers: Provider[];
  mailbox: Mailbox;
  setMailbox: (mailbox: Mailbox) => void;
  query: string;
  setQuery: (query: string) => void;
  conversations: boolean;
  setConversations: (value: boolean) => void;
  messages: Message[];
  rows: Message[];
  drafts: Draft[];
  selectedId: number | null;
  select: (id: number | null) => void;
  detail: MessageDetail | null;
  syncing: boolean;
  loadImages: boolean;
  setLoadImages: (value: boolean) => void;
  compose: ComposeState | null;
  sending: boolean;
  paletteOpen: boolean;
  setPaletteOpen: (value: boolean) => void;
  settingsOpen: boolean;
  setSettingsOpen: (value: boolean) => void;
  toasts: Toast[];
  dismissToast: (id: number) => void;
  sessionAccounts: Account[];
  switchSession: (id: number) => Promise<void>;
  moveSelection: (delta: number) => void;
  openCompose: (seed?: Partial<ComposeState>) => void;
  updateCompose: (patch: Partial<ComposeState>) => void;
  closeCompose: () => void;
  reply: (all?: boolean) => void;
  forward: () => void;
  send: () => Promise<void>;
  archive: () => Promise<void>;
  trash: () => Promise<void>;
  moveMessage: (id: number, role: string) => Promise<void>;
  reportSpam: (id?: number) => Promise<void>;
  notSpam: (id: number) => Promise<void>;
  undoSpam: (id: number) => Promise<void>;
  toggleFlag: () => Promise<void>;
  seedDemo: () => Promise<void>;
  addAccount: (body: Record<string, unknown>) => Promise<void>;
  updateAccount: (id: number, body: Record<string, unknown>) => Promise<void>;
  removeAccount: (id: number) => Promise<void>;
  saveSettings: (body: Record<string, unknown>) => Promise<void>;
  renameSession: (id: number, name: string) => Promise<void>;
  createSession: (name: string) => Promise<void>;
  startOAuth: (provider: string) => Promise<void>;
  reload: () => Promise<void>;
  openDraft: (draft: Draft) => void;
}

const MailContext = createContext<MailValue | null>(null);

function emptyCompose(accountId: number | null): ComposeState {
  return {
    accountId,
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    body: "",
    inReplyTo: "",
    references: [],
    replyToMessageId: null,
    draftId: null,
    showCc: false,
    files: [],
  };
}

export function MailProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [mailbox, setMailboxState] = useState<Mailbox>({ kind: "role", role: "inbox" });
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [conversations, setConversations] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<MessageDetail | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [loadImages, setLoadImages] = useState(false);
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [sending, setSending] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [tick, setTick] = useState(0);

  const pushToast = useCallback((text: string, undoId?: number) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [...current, { id, text, undoId }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 6000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const reload = useCallback(async () => {
    const data = await api<Bootstrap>("/api/bootstrap");
    setBoot(data);
    setLoadImages(data.settings.load_remote_images);
    setTick((value) => value + 1);
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        await connectEngine();
        const data = await api<Bootstrap>("/api/bootstrap");
        const preset = await api<Provider[]>("/api/providers");
        if (!live) return;
        setBoot(data);
        setProviders(preset);
        setLoadImages(data.settings.load_remote_images);
      } catch (err) {
        if (!live) return;
        setError(err instanceof Error ? err.message : "Session couldn't open the mailbox.");
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const theme = boot?.settings.theme ?? "system";
    const apply = () => {
      const dark =
        theme === "dark" ||
        (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      document.documentElement.dataset.density = boot?.settings.density ?? "comfortable";
    };
    apply();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [boot?.settings.theme, boot?.settings.density]);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(query), 220);
    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    if (!boot) return;
    let live = true;
    const params = new URLSearchParams({ session_id: String(boot.active_session_id), limit: "200" });
    if (mailbox.kind === "role" && mailbox.role !== "drafts") params.set("folder_role", mailbox.role);
    if (mailbox.kind === "role" && mailbox.accountId) params.set("account_id", String(mailbox.accountId));
    if (mailbox.kind === "folder") params.set("folder_id", String(mailbox.folderId));
    if (debounced.trim()) params.set("q", debounced.trim());
    api<{ messages: Message[] }>(`/api/messages?${params}`)
      .then((data) => {
        if (live) setMessages(data.messages);
      })
      .catch((err: unknown) => {
        if (live) pushToast(err instanceof Error ? err.message : "Couldn't load mail.");
      });
    api<{ drafts: Draft[] }>(`/api/drafts?session_id=${boot.active_session_id}`)
      .then((data) => {
        if (live) setDrafts(data.drafts);
      })
      .catch(() => {
        if (live) setDrafts([]);
      });
    return () => {
      live = false;
    };
  }, [boot?.active_session_id, mailbox, debounced, tick, boot, pushToast]);

  useEffect(() => {
    if (!boot) return;
    let socket: WebSocket | null = null;
    let stopped = false;
    let timer = 0;
    const connect = () => {
      socket = new WebSocket(socketUrl());
      socket.onmessage = (event) => {
        const data = JSON.parse(String(event.data)) as {
          type?: string;
          subject?: string;
          message_id?: number;
          session_id?: number;
        };
        if (data.type === "sync.start") setSyncing(true);
        if (data.type === "sync.done" || data.type === "sync.error" || data.type === "mail.new") {
          setSyncing(false);
          window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            void reload();
          }, 250);
        }
        if (data.type === "spam.auto" && data.message_id && data.session_id === boot.active_session_id) {
          pushToast(`Filed “${data.subject || "a message"}” as spam`, data.message_id);
        }
      };
      socket.onclose = () => {
        if (!stopped) window.setTimeout(connect, 1600);
      };
    };
    connect();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      socket?.close();
    };
  }, [boot?.active_session_id, pushToast, reload]);

  const rows = useMemo(() => {
    const grouped = conversations && !(mailbox.kind === "role" && mailbox.role === "spam");
    return grouped ? groupThreads(messages) : messages;
  }, [messages, conversations, mailbox]);

  useEffect(() => {
    if (mailbox.kind === "role" && mailbox.role === "drafts") return;
    if (selectedId != null && messages.some((item) => item.id === selectedId)) return;
    setSelectedId(messages[0]?.id ?? null);
  }, [messages, mailbox, selectedId]);

  useEffect(() => {
    if (selectedId == null) {
      setDetail(null);
      return;
    }
    let live = true;
    api<MessageDetail>(`/api/messages/${selectedId}`)
      .then(async (data) => {
        if (!live) return;
        if (!data.seen) {
          const updated = await api<MessageDetail>(`/api/messages/${selectedId}/flags`, {
            method: "POST",
            body: JSON.stringify({ seen: true }),
          });
          if (!live) return;
          setDetail(updated);
          setMessages((current) => current.map((item) => (item.id === updated.id ? { ...item, seen: true } : item)));
          void reload();
          return;
        }
        setDetail(data);
      })
      .catch((err: unknown) => {
        if (live) pushToast(err instanceof Error ? err.message : "Couldn't open that message.");
      });
    return () => {
      live = false;
    };
  }, [selectedId, pushToast, reload]);

  useEffect(() => {
    if (!compose || sending) return;
    if (!compose.accountId) return;
    if (!compose.to && !compose.subject && !compose.body) return;
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
          body: snapshot.body,
          in_reply_to: snapshot.inReplyTo,
          references: snapshot.references,
          reply_to_message_id: snapshot.replyToMessageId,
        }),
      })
        .then((draft) => {
          setCompose((current) => {
            if (!current || current.draftId === draft.id) return current;
            return { ...current, draftId: draft.id };
          });
        })
        .catch(() => undefined);
    }, 800);
    return () => window.clearTimeout(handle);
  }, [compose, sending]);

  const sessionAccounts = useMemo(
    () => (boot ? boot.accounts.filter((account) => account.session_id === boot.active_session_id) : []),
    [boot],
  );

  const setMailbox = useCallback((next: Mailbox) => {
    setMailboxState(next);
    setSelectedId(null);
  }, []);

  const switchSession = useCallback(
    async (id: number) => {
      const data = await api<Bootstrap>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ active_session_id: id }),
      });
      setBoot(data);
      setMailboxState({ kind: "role", role: "inbox" });
      setQuery("");
      setSelectedId(null);
      setCompose(null);
      setPaletteOpen(false);
    },
    [],
  );

  const moveSelection = useCallback(
    (delta: number) => {
      if (!rows.length) return;
      const index = Math.max(0, rows.findIndex((item) => item.id === selectedId));
      const next = rows[Math.min(rows.length - 1, Math.max(0, index + delta))];
      if (next) setSelectedId(next.id);
    },
    [rows, selectedId],
  );

  const openCompose = useCallback(
    (seed?: Partial<ComposeState>) => {
      const accountId = seed?.accountId ?? sessionAccounts[0]?.id ?? null;
      setCompose({ ...emptyCompose(accountId), ...seed, accountId: seed?.accountId ?? accountId });
    },
    [sessionAccounts],
  );

  const updateCompose = useCallback((patch: Partial<ComposeState>) => {
    setCompose((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const closeCompose = useCallback(() => setCompose(null), []);

  const reply = useCallback(
    (all = false) => {
      if (!detail) return;
      const mine = detail.account_email;
      openCompose({
        accountId: detail.account_id,
        to: all ? replyAllTo(detail, mine) : detail.from_email,
        cc: "",
        subject: subjectWith("Re:", detail.subject),
        body: quoteBody(detail),
        inReplyTo: detail.message_id,
        references: [...detail.references, detail.message_id].filter(Boolean),
        replyToMessageId: detail.id,
        showCc: false,
      });
    },
    [detail, openCompose],
  );

  const forward = useCallback(() => {
    if (!detail) return;
    openCompose({
      accountId: detail.account_id,
      subject: subjectWith("Fwd:", detail.subject),
      body: quoteBody(detail),
    });
  }, [detail, openCompose]);

  const refreshAfter = useCallback(async () => {
    setSelectedId(null);
    await reload();
  }, [reload]);

  const send = useCallback(async () => {
    if (!compose?.accountId) return;
    if (!compose.to.trim()) {
      pushToast("Add a recipient.");
      return;
    }
    setSending(true);
    try {
      await api("/api/send", {
        method: "POST",
        body: JSON.stringify({
          account_id: compose.accountId,
          to: compose.to,
          cc: compose.cc,
          bcc: compose.bcc,
          subject: compose.subject,
          body: compose.body,
          in_reply_to: compose.inReplyTo,
          references: compose.references,
          reply_to_message_id: compose.replyToMessageId,
          draft_id: compose.draftId,
          attachments: compose.files,
        }),
      });
      setCompose(null);
      setMailboxState({ kind: "role", role: "sent" });
      setQuery("");
      setDebounced("");
      setSelectedId(null);
      pushToast("Sent.");
      await reload();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Couldn't send.");
    } finally {
      setSending(false);
    }
  }, [compose, pushToast, reload]);

  const moveMessage = useCallback(
    async (id: number, role: string) => {
      try {
        await api(`/api/messages/${id}/move`, { method: "POST", body: JSON.stringify({ role }) });
        await refreshAfter();
      } catch (err) {
        pushToast(err instanceof Error ? err.message : "Couldn't move that message.");
      }
    },
    [pushToast, refreshAfter],
  );

  const moveCurrent = useCallback(
    async (role: string) => {
      if (!detail) return;
      await moveMessage(detail.id, role);
    },
    [detail, moveMessage],
  );

  const reportSpam = useCallback(
    async (id?: number) => {
      const messageId = id ?? detail?.id;
      if (!messageId) return;
      try {
        await api(`/api/messages/${messageId}/spam`, { method: "POST" });
        await refreshAfter();
      } catch (err) {
        pushToast(err instanceof Error ? err.message : "Couldn't mark that as spam.");
      }
    },
    [detail, pushToast, refreshAfter],
  );

  const notSpam = useCallback(
    async (id: number) => {
      try {
        await api(`/api/messages/${id}/not-spam`, { method: "POST" });
        await refreshAfter();
      } catch (err) {
        pushToast(err instanceof Error ? err.message : "Couldn't move that back.");
      }
    },
    [pushToast, refreshAfter],
  );

  const undoSpam = useCallback(
    async (id: number) => {
      try {
        await api(`/api/messages/${id}/spam/undo`, { method: "POST" });
        await reload();
      } catch (err) {
        pushToast(err instanceof Error ? err.message : "Couldn't undo that.");
      }
    },
    [pushToast, reload],
  );

  const toggleFlag = useCallback(async () => {
    if (!detail) return;
    try {
      const updated = await api<MessageDetail>(`/api/messages/${detail.id}/flags`, {
        method: "POST",
        body: JSON.stringify({ flagged: !detail.flagged }),
      });
      setDetail(updated);
      setMessages((current) => current.map((item) => (item.id === updated.id ? { ...item, flagged: updated.flagged } : item)));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Couldn't update the flag.");
    }
  }, [detail, pushToast]);

  const run = useCallback(
    async (work: () => Promise<void>) => {
      try {
        await work();
      } catch (err) {
        pushToast(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "That didn't work.");
      }
    },
    [pushToast],
  );

  const value: MailValue = {
    loading,
    error,
    boot,
    providers,
    mailbox,
    setMailbox,
    query,
    setQuery,
    conversations,
    setConversations,
    messages,
    rows,
    drafts,
    selectedId,
    select: setSelectedId,
    detail,
    syncing,
    loadImages,
    setLoadImages,
    compose,
    sending,
    paletteOpen,
    setPaletteOpen,
    settingsOpen,
    setSettingsOpen,
    toasts,
    dismissToast,
    sessionAccounts,
    switchSession: (id) => run(() => switchSession(id)),
    moveSelection,
    openCompose,
    updateCompose,
    closeCompose,
    reply,
    forward,
    send,
    archive: () => moveCurrent("archive"),
    trash: () => moveCurrent("trash"),
    moveMessage,
    reportSpam,
    notSpam,
    undoSpam,
    toggleFlag,
    seedDemo: () => run(async () => { await api("/api/demo/seed", { method: "POST" }); await reload(); }),
    addAccount: (body) => run(async () => { await api("/api/accounts", { method: "POST", body: JSON.stringify(body) }); await reload(); }),
    updateAccount: (id, body) => run(async () => { await api(`/api/accounts/${id}`, { method: "PATCH", body: JSON.stringify(body) }); await reload(); }),
    removeAccount: (id) => run(async () => { await api(`/api/accounts/${id}`, { method: "DELETE" }); await reload(); }),
    saveSettings: (body) => run(async () => { setBoot(await api<Bootstrap>("/api/settings", { method: "PATCH", body: JSON.stringify(body) })); }),
    renameSession: (id, name) => run(async () => { await api(`/api/sessions/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }); await reload(); }),
    createSession: (name) => run(async () => { await api("/api/sessions", { method: "POST", body: JSON.stringify({ name }) }); await reload(); }),
    startOAuth: (provider) =>
      run(async () => {
        if (!boot) return;
        pushToast("Waiting for the browser sign-in…");
        await api("/api/oauth/start", {
          method: "POST",
          body: JSON.stringify({ provider, session_id: boot.active_session_id }),
        });
        await reload();
        pushToast("Account connected.");
      }),
    reload,
    openDraft: (draft) =>
      openCompose({
        accountId: draft.account_id,
        to: draft.to,
        cc: draft.cc,
        bcc: draft.bcc,
        subject: draft.subject,
        body: draft.body,
        inReplyTo: draft.in_reply_to,
        references: draft.references,
        replyToMessageId: draft.reply_to_message_id,
        draftId: draft.id,
        showCc: Boolean(draft.cc || draft.bcc),
      }),
  };

  return <MailContext.Provider value={value}>{children}</MailContext.Provider>;
}

export function useMail(): MailValue {
  const value = useContext(MailContext);
  if (!value) throw new Error("useMail must be used inside MailProvider");
  return value;
}
