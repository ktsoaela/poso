/** Bridge to the Electron shell (see electron/preload.cjs), with browser fallbacks for `npm run dev`. */

export interface NotifyOptions {
  title: string;
  body?: string;
  /** Comes back to `onNotificationClick` so the UI can open the right item, e.g. `mail:42` or `reminders:7`. */
  tag?: string;
  silent?: boolean;
  /** Stays on screen until dismissed (used for reminders). */
  urgent?: boolean;
}

interface SessionDesktop {
  isElectron: true;
  notificationsSupported: () => Promise<boolean>;
  notify: (options: NotifyOptions) => Promise<boolean>;
  onNotificationClick: (handler: (tag: string) => void) => () => void;
  windowFocused: () => Promise<boolean>;
}

declare global {
  interface Window {
    sessionDesktop?: SessionDesktop;
  }
}

const bridge = typeof window !== "undefined" ? window.sessionDesktop : undefined;
const clickHandlers = new Set<(tag: string) => void>();

export const inElectron = Boolean(bridge?.isElectron);

export function notificationPermission(): NotificationPermission {
  if (inElectron) return "granted";
  return "Notification" in window ? Notification.permission : "denied";
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (inElectron) return "granted";
  if (!("Notification" in window)) return "denied";
  if (Notification.permission === "default") return Notification.requestPermission();
  return Notification.permission;
}

/** True when the user is not looking at Poso (minimised, behind another window, or a hidden tab). */
export function appInBackground(): boolean {
  return document.hidden || !document.hasFocus();
}

export async function notify(options: NotifyOptions): Promise<boolean> {
  if (bridge) {
    try {
      return await bridge.notify(options);
    } catch {
      return false;
    }
  }
  if (!("Notification" in window) || Notification.permission !== "granted") return false;
  const notification = new Notification(options.title, { body: options.body, tag: options.tag, silent: options.silent, requireInteraction: options.urgent });
  notification.onclick = () => {
    window.focus();
    notification.close();
    if (options.tag) clickHandlers.forEach((handler) => handler(options.tag as string));
  };
  return true;
}

export function onNotificationClick(handler: (tag: string) => void): () => void {
  clickHandlers.add(handler);
  const unbind = bridge?.onNotificationClick(handler);
  return () => {
    clickHandlers.delete(handler);
    unbind?.();
  };
}
