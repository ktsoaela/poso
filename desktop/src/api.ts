export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let baseUrl = "http://127.0.0.1:8765";
let token = "dev-session-token";

export function engineBase(): string {
  return baseUrl;
}

export async function connectEngine(): Promise<void> {
  const internals = "__TAURI_INTERNALS__" in window;
  if (internals) {
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

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "Session can't reach the mail engine on port 8765.");
  }
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const data = (await response.json()) as { detail?: unknown };
      if (typeof data.detail === "string") detail = data.detail;
      else if (Array.isArray(data.detail)) {
        detail = data.detail.map((item) => (typeof item === "object" && item && "msg" in item ? String(item.msg) : String(item))).join(" ");
      }
    } catch {
      /* keep the status text */
    }
    throw new ApiError(response.status, detail || "The mail engine returned an error.");
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function downloadFile(path: string, filename: string): Promise<void> {
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${baseUrl}${path}`, { headers });
  if (!response.ok) throw new ApiError(response.status, "That attachment is unavailable.");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
