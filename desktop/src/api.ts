export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let baseUrl = "http://127.0.0.1:8765";
let token = "dev-session-token";

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function engineBase(): string {
  return baseUrl;
}

export async function connectEngine(): Promise<void> {
  if (inTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    const info = await invoke<{ base_url: string; token: string }>("engine_info");
    baseUrl = info.base_url;
    token = info.token;
    return;
  }
  baseUrl = import.meta.env.VITE_ENGINE_URL || "http://127.0.0.1:8765";
  token = import.meta.env.VITE_ENGINE_TOKEN || "dev-session-token";
}

export function socketUrl(): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.searchParams.set("token", token);
  return url.toString();
}

async function errorFrom(response: Response): Promise<ApiError> {
  let detail = response.statusText;
  try {
    const data = (await response.json()) as { detail?: unknown };
    if (typeof data.detail === "string") detail = data.detail;
    else if (Array.isArray(data.detail)) {
      detail = data.detail
        .map((item) => (typeof item === "object" && item && "msg" in item ? String(item.msg) : String(item)))
        .join(" ");
    }
  } catch {
    /* keep the status text */
  }
  return new ApiError(response.status, detail || "The mail engine returned an error.");
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "Session can't reach the mail engine.");
  }
  if (!response.ok) throw await errorFrom(response);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const post = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export async function downloadFile(path: string, fallbackName = "download"): Promise<string> {
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${baseUrl}${path}`, { headers });
  if (!response.ok) throw await errorFrom(response);
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const filename = match ? match[1] : fallbackName;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  return filename;
}

export async function openExternal(url: string): Promise<void> {
  if (!/^(https?:|mailto:|tel:)/i.test(url)) return;
  if (inTauri) {
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
      return;
    } catch {
      /* fall through to the browser */
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
