export interface Session {
  id: number;
  name: string;
  color: string;
  sort_order: number;
  unread: number;
}

export interface Account {
  id: number;
  session_id: number;
  email: string;
  username: string;
  display_name: string;
  provider: string;
  auth_type: string;
  imap_host: string;
  imap_port: number;
  imap_ssl: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_mode: string;
  color: string;
  sync_enabled: boolean;
  signature: string;
  last_sync_at: string | null;
  last_error: string;
}

export interface MailFolder {
  id: number;
  account_id: number;
  imap_name: string;
  role: string;
  unread: number;
}

export interface Label {
  id: number;
  session_id: number;
  name: string;
  color: string;
}

export interface Address {
  name: string;
  email: string;
}

export interface Message {
  id: number;
  account_id: number;
  folder_id: number;
  thread_id: string;
  subject: string;
  from_name: string;
  from_email: string;
  to: Address[];
  cc: Address[];
  date: string | null;
  snippet: string;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  auto_spam: boolean;
  spam_score: number | null;
  has_body: boolean;
  account_email: string;
  account_color: string;
  folder_role: string;
  folder_name: string;
  labels: number[];
  has_attachments: boolean;
  snoozed_until: string | null;
  pinned: boolean;
  threadCount?: number;
  threadUnread?: boolean;
  threadIds?: number[];
}

export interface Attachment {
  id: number;
  filename: string;
  content_type: string;
  size: number;
}

export interface MessageDetail extends Message {
  body_text: string;
  body_html: string;
  message_id: string;
  in_reply_to: string;
  references: string[];
  attachments: Attachment[];
  thread: Message[];
  size: number;
}

export interface Draft {
  id: number;
  account_id: number;
  account_email: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  in_reply_to: string;
  references: string[];
  reply_to_message_id: number | null;
  updated_at: string | null;
}

export interface OutboxItem {
  id: number;
  account_id: number;
  account_email: string;
  send_at: string | null;
  status: string;
  error: string;
  to: string;
  subject: string;
  snippet: string;
  payload: Record<string, unknown>;
}

export interface Provider {
  id: string;
  label: string;
  imap_host: string;
  imap_port: number;
  imap_ssl: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_mode: string;
  oauth: string | null;
  hint: string;
}

export type Accent = "indigo" | "blue" | "teal" | "violet" | "rose" | "amber" | "slate";

export interface AppSettings {
  theme: "light" | "dark" | "system";
  density: "comfortable" | "compact";
  load_remote_images: boolean;
  reading_pane: "right" | "bottom" | "off";
  accent: Accent;
  undo_send_seconds: number;
  notify: boolean;
  conversations: boolean;
}

export interface Bootstrap {
  version: string;
  active_session_id: number;
  sessions: Session[];
  accounts: Account[];
  folders: MailFolder[];
  labels: Label[];
  counts: {
    scheduled: number;
    flagged: Record<string, number>;
    snoozed: Record<string, number>;
  };
  settings: AppSettings;
  oauth: {
    google_client_id: string;
    google_has_secret: boolean;
    microsoft_client_id: string;
    microsoft_has_secret: boolean;
    redirect_uri: string;
  };
}

export type RoleName =
  | "inbox"
  | "flagged"
  | "snoozed"
  | "unread"
  | "everything"
  | "scheduled"
  | "sent"
  | "drafts"
  | "archive"
  | "trash"
  | "spam";

export type Mailbox =
  | { kind: "role"; role: RoleName; accountId?: number }
  | { kind: "folder"; folderId: number }
  | { kind: "label"; labelId: number };

export type QuickFilter = "all" | "unread" | "flagged" | "attachments";

export interface ComposeFile {
  filename: string;
  content_type: string;
  data_base64: string;
  size: number;
}

export interface ComposeState {
  key: number;
  accountId: number | null;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  html: string;
  inReplyTo: string;
  references: string[];
  replyToMessageId: number | null;
  draftId: number | null;
  showCc: boolean;
  files: ComposeFile[];
  priority: "normal" | "high";
  readReceipt: boolean;
  minimized: boolean;
  expanded: boolean;
}

export interface Toast {
  id: number;
  text: string;
  tone?: "default" | "success" | "error";
  action?: { label: string; run: () => void };
  ttl?: number;
}

export interface BlockEntry {
  id: number;
  kind: string;
  value: string;
}

export interface RuleCondition {
  field: "from" | "to" | "subject" | "body" | "any" | "account";
  op: "contains" | "not_contains" | "equals" | "starts_with" | "ends_with";
  value: string;
}

export interface RuleAction {
  type: "move" | "label" | "read" | "flag" | "spam" | "archive" | "trash";
  role?: string;
  label_id?: number;
}

export interface Rule {
  id: number;
  session_id: number;
  name: string;
  enabled: boolean;
  match: "all" | "any";
  conditions: RuleCondition[];
  actions: RuleAction[];
  stop: boolean;
  sort_order: number;
}

export interface AuditEvent {
  id: number;
  at: string | null;
  session_id: number | null;
  account_id: number | null;
  actor: string;
  action: string;
  target: string;
  detail: string;
}

export interface Contact {
  email: string;
  name: string;
  count: number;
  last: string | null;
}
