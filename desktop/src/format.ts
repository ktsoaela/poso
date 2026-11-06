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
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function formatFull(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export function people(list: Address[]): string {
  return list.map((item) => item.name || item.email).filter(Boolean).join(", ");
}

export function folderLabel(name: string): string {
  const leaf = name.split("/").pop() || name;
  if (leaf.toLowerCase() === "inbox") return "Inbox";
  return leaf;
}

export function groupThreads(messages: Message[]): Message[] {
  const map = new Map<string, Message>();
  for (const message of messages) {
    const key = message.thread_id || `id:${message.id}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...message, threadCount: 1 });
      continue;
    }
    existing.threadCount = (existing.threadCount || 1) + 1;
  }
  return [...map.values()];
}

export function prepareHtml(html: string, loadImages: boolean): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, iframe, object, embed, link, meta").forEach((node) => node.remove());
  doc.querySelectorAll("*").forEach((node) => {
    [...node.attributes].forEach((attr) => {
      if (attr.name.startsWith("on")) node.removeAttribute(attr.name);
    });
  });
  if (!loadImages) {
    doc.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src");
      if (src && !src.startsWith("data:") && !src.startsWith("cid:")) {
        img.setAttribute("data-blocked-src", src);
        img.removeAttribute("src");
      }
    });
  }
  return doc.body.innerHTML;
}

export function quoteBody(detail: MessageDetail): string {
  const who = detail.from_name || detail.from_email;
  const when = formatFull(detail.date);
  const quoted = (detail.body_text || "").split("\n").map((line) => `> ${line}`).join("\n");
  return `\n\nOn ${when}, ${who} wrote:\n${quoted}`;
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
