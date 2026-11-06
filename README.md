<div align="center">
  <img src="docs/logo.svg" alt="Session" width="128" style="background:#ffffff;padding:16px;border-radius:12px" />

  <h1>Session</h1>

  <p><strong>A desktop mail client that keeps business and personal inboxes in separate sessions.</strong></p>

  <p>
    <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-375348?style=flat-square" /></a>
    <a href="docs/guide.md"><img alt="Docs" src="https://img.shields.io/badge/docs-guide-547f72?style=flat-square" /></a>
    <img alt="Stack" src="https://img.shields.io/badge/Tauri_2-FastAPI-436659?style=flat-square" />
  </p>
</div>

**Author:** [Khotso Tsoaela](https://github.com/ktsoaela) (`@ktsoaela`)

---

**Session** is a Windows mail client with a quiet three-pane window. One click swaps the whole workspace between work addresses and personal addresses. Search, spam, and the compose From menu stay inside the session you picked.

Mail is synced over IMAP and sent over SMTP, including Gmail and Outlook accounts that sign in through the browser. The UI runs in a Tauri window. A FastAPI engine on your machine stores mail in SQLite and keeps passwords in Windows Credential Manager.

---

## Why Session

- **Sessions** split business addresses and personal addresses into workspaces you can switch without mixing the inbox.
- **One list** shows every account in the active session, with a color so you can still see which address received the mail.
- **Spam** collects provider junk, a blocklist, and a local filter trained from the mail you mark.
- **Reading** keeps a short line and blocks remote images until you load them.

## Quick start

**Requirements:** Python 3.11 or newer, Node.js 20 or newer. Rust with the MSVC toolchain is only needed for the desktop window and the installer.

```powershell
.\scripts\dev.ps1
```

The script opens the engine in another window and serves the UI at http://localhost:1420. On the first screen, choose **Explore with sample mail** or add an IMAP account.

| Goal | Command |
| --- | --- |
| Run Session | `.\scripts\dev.ps1` → http://localhost:1420 |
| Engine tests | `cd engine; .\.venv\Scripts\python.exe -m pytest` |
| Desktop window | `.\scripts\prepare-dev-sidecar.ps1` then `cd desktop; npm run tauri dev` |
| Windows installer | `.\scripts\build-windows.ps1` |

## Layout

| Path | What it is |
| --- | --- |
| `engine/` | FastAPI mail engine: accounts, IMAP sync, SMTP, search, spam |
| `desktop/` | Tauri shell and React UI |
| `docs/guide.md` | Sessions, sign-in, spam, shortcuts, and the installer |
| `scripts/` | Dev server, sidecar launcher, and Windows build |

## Stack

| Layer | Choice |
| --- | --- |
| Window | Tauri 2 |
| UI | React, TypeScript, Vite, Tailwind |
| Engine | FastAPI |
| Mail | IMAP, SMTP, XOAUTH2 |
| Storage | SQLite, Windows Credential Manager |

---

## Documentation map

| Doc | Purpose |
| --- | --- |
| [Guide](docs/guide.md) | Accounts, OAuth redirect, spam, shortcuts, and the Windows build |

---

## License

MIT. Copyright 2026 Khotso Tsoaela.
