const { app, BrowserWindow, Notification, ipcMain, shell } = require("electron");
const fs = require("fs");
const path = require("path");

const uiUrl = process.env.SESSION_UI_URL || "http://localhost:1420";
const screenshotPath = process.env.SESSION_SCREENSHOT || "";

const APP_ID = "app.poso.mail";
app.setAppUserModelId(APP_ID);

function ensureStartMenuShortcut() {
  if (process.platform !== "win32" || !process.env.APPDATA) return;
  const programs = path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs");
  const shortcut = path.join(programs, "Poso.lnk");
  const previous = path.join(programs, "Session.lnk");
  try {
    if (fs.existsSync(previous)) fs.unlinkSync(previous);
  } catch {
    /* the old shortcut can stay if Windows is holding it */
  }
  const packaged = app.isPackaged;
  const written = shell.writeShortcutLink(shortcut, {
    target: process.execPath,
    args: packaged ? "" : `"${app.getAppPath()}"`,
    cwd: packaged ? path.dirname(process.execPath) : app.getAppPath(),
    description: "Poso mail",
    icon: iconPath(),
    iconIndex: 0,
    appUserModelId: APP_ID,
  });
  if (!written) console.error("Could not write the Poso Start menu shortcut:", shortcut);
}

function iconPath() {
  const installed = path.join(process.resourcesPath, "icon.ico");
  if (fs.existsSync(installed)) return installed;
  return path.join(__dirname, "icon.ico");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForMail(win) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const ready = await win.webContents.executeJavaScript("Boolean(document.querySelector('.msg-row'))");
    if (ready) return true;
    await sleep(250);
  }
  return false;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: "Poso",
    icon: iconPath(),
    backgroundColor: "#101411",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("did-finish-load", () => {
    if (!screenshotPath) return;
    void (async () => {
      const ready = await waitForMail(win);
      if (ready) {
        await win.webContents.executeJavaScript("document.querySelector('.msg-row')?.click()");
        await sleep(700);
      }
      const image = await win.webContents.capturePage();
      fs.writeFileSync(screenshotPath, image.toPNG());
    })();
  });

  void win.loadURL(uiUrl);
}

// Native notifications. Keep references until they close; Windows drops click events for collected ones.
const live = new Set();

function mainWindow() {
  return BrowserWindow.getAllWindows()[0] || null;
}

function showWindow(win) {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function clean(value, max) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

ipcMain.handle("notify:supported", () => Notification.isSupported());
ipcMain.handle("window:focused", (event) => Boolean(BrowserWindow.fromWebContents(event.sender)?.isFocused()));
ipcMain.handle("notify:show", (event, options = {}) => {
  if (!Notification.isSupported()) return false;
  const win = BrowserWindow.fromWebContents(event.sender);
  const tag = clean(options.tag, 200);
  const notification = new Notification({
    title: clean(options.title, 200) || "Poso",
    body: clean(options.body, 1000),
    icon: iconPath(),
    silent: Boolean(options.silent),
    urgency: options.urgent ? "critical" : "normal",
    timeoutType: options.urgent ? "never" : "default",
  });
  live.add(notification);
  const forget = () => live.delete(notification);
  notification.on("click", () => {
    const target = win && !win.isDestroyed() ? win : mainWindow();
    if (target) {
      showWindow(target);
      target.webContents.send("notify:click", tag);
    }
    forget();
  });
  notification.on("close", forget);
  notification.on("failed", forget);
  notification.show();
  if (win && !win.isFocused()) win.flashFrame(true);
  return true;
});

app.on("browser-window-focus", (_event, win) => win.flashFrame(false));

if (process.env.SESSION_SHORTCUT_ONLY === "1") {
  app.whenReady().then(() => {
    ensureStartMenuShortcut();
    app.exit(0);
  });
} else {
  const single = app.requestSingleInstanceLock();
  if (!single) {
    app.quit();
  } else {
    app.on("second-instance", () => {
      const win = mainWindow();
      if (win) showWindow(win);
    });
    app.whenReady().then(() => {
      ensureStartMenuShortcut();
      createWindow();
    });
  }
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
