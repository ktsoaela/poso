const { app, BrowserWindow, shell } = require("electron");
const fs = require("fs");

const uiUrl = process.env.SESSION_UI_URL || "http://localhost:1420";
const screenshotPath = process.env.SESSION_SCREENSHOT || "";

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
    title: "Session",
    backgroundColor: "#101411",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
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

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
