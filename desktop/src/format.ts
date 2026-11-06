import type { Address, Message, MessageDetail } from "./types";

export function formatWhen(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString([], sameYear ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" });
}

export function formatFull(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { weekday: "short", dateStyle: undefined, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function relative(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return "never";
  const minutes = Math.round(diff / 60000);
  if (Math.abs(minutes) < 1) return "just now";
  if (minutes < 0) {
    const ahead = -minutes;
    if (ahead < 60) return `in ${ahead} min`;
    if (ahead < 1440) return `in ${Math.round(ahead / 60)} h`;
    return `in ${Math.round(ahead / 1440)} d`;
  }
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} d ago`;
}

export function people(list: Address[]): string {
  return list.map((item) => item.name || item.email).filter(Boolean).join(", ");
}

export function folderLabel(name: string): string {
  const leaf = name.split(/[/.]/).pop() || name;
  if (leaf.toLowerCase() === "inbox") return "Inbox";
  return leaf;
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10240 ? 1 : 0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function initials(name: string, email: string): string {
  const source = (name || email || "?").replace(/["']/g, "").trim();
  const parts = source.split(/[\s._@-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#14b8a6", "#f97316", "#64748b"];

export function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function groupThreads(messages: Message[]): Message[] {
  const map = new Map<string, Message>();
  for (const message of messages) {
    const key = message.thread_id ? `${message.account_id}:${message.thread_id}` : `id:${message.id}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...message, threadCount: 1, threadUnread: !message.seen, threadIds: [message.id] });
      continue;
    }
    existing.threadCount = (existing.threadCount || 1) + 1;
    existing.threadUnread = existing.threadUnread || !message.seen;
    existing.threadIds = [...(existing.threadIds || []), message.id];
    existing.flagged = existing.flagged || message.flagged;
    existing.has_attachments = existing.has_attachments || message.has_attachments;
    existing.labels = [...new Set([...existing.labels, ...message.labels])];
  }
  return [...map.values()];
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);
}

export function textToHtml(text: string): string {
  const linked = escapeHtml(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  return linked.replace(/\n/g, "<br>");
}

export function hasRemoteContent(html: string): boolean {
  return /(src|background)\s*=\s*["']?\s*(https?:)?\/\//i.test(html) || /url\(\s*['"]?\s*(https?:)?\/\//i.test(html);
}

/**
 * Wrap sanitized message HTML in a standalone document for a sandboxed iframe.
 * The CSP blocks every network load unless the reader allowed remote content, and the
 * iframe sandbox (no allow-scripts) keeps anything executable from running.
 */
export function buildSrcdoc(html: string, text: string, allowRemote: boolean): string {
  const remote = allowRemote ? " https: http:" : "";
  const csp = [
    "default-src 'none'",
    `img-src data: cid: blob:${remote}`,
    `style-src 'unsafe-inline'${remote}`,
    `font-src data:${remote}`,
    "script-src 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "media-src 'none'",
  ].join("; ");
  const body = html || `<div class="plain">${textToHtml(text || "")}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<base target="_blank">
<style>
  html,body{margin:0;padding:0;background:#fff;color:#111827}
  body{font:14px/1.6 "Inter Variable","Segoe UI",system-ui,sans-serif;padding:4px 2px 12px;overflow-wrap:anywhere;word-break:break-word}
  img{max-width:100%;height:auto}
  img:not([src]){display:inline-block;min-width:48px;min-height:24px;background:#f1f5f9;border-radius:6px}
  table{max-width:100%}
  pre{white-space:pre-wrap}
  blockquote{margin:8px 0;padding-left:12px;border-left:3px solid #e2e8f0;color:#475569}
  a{color:#4f46e5}
  .plain{white-space:normal}
</style></head><body>${body}</body></html>`;
}

export function quoteHtml(detail: MessageDetail): string {
  const who = escapeHtml(detail.from_name ? `${detail.from_name} <${detail.from_email}>` : detail.from_email);
  const when = escapeHtml(formatFull(detail.date));
  const original = detail.body_html || textToHtml(detail.body_text || detail.snippet || "");
  return `<p><br></p><div class="quote-head">On ${when}, ${who} wrote:</div><blockquote>${original}</blockquote>`;
}

export function forwardHtml(detail: MessageDetail): string {
  const original = detail.body_html || textToHtml(detail.body_text || detail.snippet || "");
  const rows = [
    ["From", detail.from_name ? `${detail.from_name} <${detail.from_email}>` : detail.from_email],
    ["Date", formatFull(detail.date)],
    ["Subject", detail.subject],
    ["To", people(detail.to)],
  ]
    .map(([key, value]) => `<b>${key}:</b> ${escapeHtml(value || "")}`)
    .join("<br>");
  return `<p><br></p><div class="quote-head">---------- Forwarded message ----------<br>${rows}</div><br>${original}`;
}

export function replyAllTo(detail: MessageDetail, mine: string): string {
  const emails = [detail.from_email, ...detail.to.map((item) => item.email), ...detail.cc.map((item) => item.email)];
  const unique = [...new Set(emails.map((item) => item.trim()).filter(Boolean))];
  return unique.filter((item) => item.toLowerCase() !== mine.toLowerCase()).join(", ");
}

export function subjectWith(prefix: string, subject: string): string {
  const cleaned = subject.replace(/^\(no subject\)$/, "");
  if (!cleaned) return prefix;
  if (cleaned.toLowerCase().startsWith(prefix.toLowerCase())) return cleaned;
  return `${prefix} ${cleaned}`;
}

function at(days: number, hour: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date;
}

export function timePresets(): { label: string; hint: string; when: Date }[] {
  const now = new Date();
  const later = new Date(now.getTime() + 3 * 3600 * 1000);
  const tonight = at(0, 19);
  const daysToMonday = ((8 - now.getDay()) % 7) || 7;
  const daysToSaturday = ((6 - now.getDay() + 7) % 7) || 7;
  const options = [
    { label: "Later today", when: later },
    ...(tonight > later ? [{ label: "This evening", when: tonight }] : []),
    { label: "Tomorrow", when: at(1, 8) },
    { label: "This weekend", when: at(daysToSaturday, 9) },
    { label: "Next week", when: at(daysToMonday, 8) },
  ];
  return options.map((item) => ({
    ...item,
    hint: item.when.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }),
  }));
}

export function toLocalInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function printMessage(detail: MessageDetail): void {
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.setAttribute("sandbox", "allow-same-origin allow-modals");
  const header = `<div style="font:13px Segoe UI,sans-serif;border-bottom:1px solid #e5e7eb;padding-bottom:12px;margin-bottom:16px">
    <h2 style="margin:0 0 8px">${escapeHtml(detail.subject)}</h2>
    <div><b>From:</b> ${escapeHtml(detail.from_name || "")} &lt;${escapeHtml(detail.from_email)}&gt;</div>
    <div><b>To:</b> ${escapeHtml(people(detail.to) || detail.account_email)}</div>
    <div><b>Date:</b> ${escapeHtml(formatFull(detail.date))}</div></div>`;
  frame.srcdoc = buildSrcdoc(header + (detail.body_html || textToHtml(detail.body_text)), "", false);
  document.body.appendChild(frame);
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    window.setTimeout(() => frame.remove(), 1000);
  };
}

export const SEARCH_HINTS: { token: string; hint: string }[] = [
  { token: "from:", hint: "Sender name or address" },
  { token: "to:", hint: "Recipient" },
  { token: "subject:", hint: "Words in the subject" },
  { token: "has:attachment", hint: "Messages with files" },
  { token: "is:unread", hint: "Unread messages" },
  { token: "is:flagged", hint: "Flagged / starred" },
  { token: "is:snoozed", hint: "Snoozed messages" },
  { token: "label:", hint: "A label name" },
  { token: "in:", hint: "inbox, sent, archive, spam, trash" },
  { token: "account:", hint: "One address in this session" },
  { token: "after:", hint: "YYYY-MM-DD" },
  { token: "before:", hint: "YYYY-MM-DD" },
  { token: "newer:", hint: "7d, 2w, 3m, 1y" },
];
