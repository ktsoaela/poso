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
  threadCount?: number;
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

export interface Bootstrap {
  active_session_id: number;
  sessions: Session[];
  accounts: Account[];
  folders: MailFolder[];
  settings: {
    theme: "light" | "dark" | "system";
    density: "comfortable" | "compact";
    load_remote_images: boolean;
  };
  oauth: {
    google_client_id: string;
    google_has_secret: boolean;
    microsoft_client_id: string;
    microsoft_has_secret: boolean;
    redirect_uri: string;
  };
}

export type RoleName = "inbox" | "sent" | "drafts" | "archive" | "trash" | "spam";

export type Mailbox =
  | { kind: "role"; role: RoleName; accountId?: number }
  | { kind: "folder"; folderId: number };

export interface ComposeFile {
  filename: string;
  content_type: string;
  data_base64: string;
}

export interface ComposeState {
  accountId: number | null;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  inReplyTo: string;
  references: string[];
  replyToMessageId: number | null;
  draftId: number | null;
  showCc: boolean;
  files: ComposeFile[];
}

export interface Toast {
  id: number;
  text: string;
  undoId?: number;
}

export interface BlockEntry {
  id: number;
  kind: string;
  value: string;
}
