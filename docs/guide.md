# Guide

Session is a local mail client. The window talks to a FastAPI engine on `127.0.0.1`.

## Sessions

A session is a workspace. **Business** and **Personal** are created the first time the engine starts. Each account belongs to one session. The inbox, search, spam queue, and the From menu only show the active session.

Rename a session from the first-run screen, or add another one there. Move an account from Settings. `Ctrl+1` and `Ctrl+2` switch the first two sessions. `Ctrl+K` opens the command palette.

## Accounts

Provider presets fill the hosts for Gmail, Outlook, Yahoo, iCloud, and a custom IMAP server.

Gmail, Yahoo, and iCloud still accept an app password when the provider allows one. Outlook.com and Microsoft 365 accounts need browser sign-in. Passwords and refresh tokens are stored in Windows Credential Manager under the service name `SessionMail`. The mailbox itself is a SQLite file at `%APPDATA%\Session\mail.db`.

The button **Explore with sample mail** loads five local addresses so the window can be tried without a server. Those addresses do not send real mail. Sending from a sample account stores the message in that account's Sent folder.

## Google and Microsoft sign-in

Create an OAuth client and paste the id into Settings. The redirect URI for both is:

```text
http://127.0.0.1:8734/callback
```

Google needs the scope `https://mail.google.com/` and offline access. Microsoft needs `IMAP.AccessAsUser.All`, `SMTP.Send`, and `offline_access`. Session uses PKCE. A client secret is optional for a public desktop client and required for a confidential one. Save it in Settings if the provider issued one. It is kept in Credential Manager, not in the database.

Sign-in opens the system browser. The engine listens on port `8734` until the provider redirects back, then connects with XOAUTH2.

## Spam

Spam is per session.

- The provider Junk folder is included in the session spam queue.
- **Spam** moves the message to Junk and blocklists the sender.
- **Not spam** moves it to Inbox, allowlists the sender, and trains the local filter.
- After enough reports, a small naive Bayes model files high-scoring inbox mail into Junk. A toast offers **Undo**, which moves it back and trains it as mail you want.

Allowlisted senders are not auto-filed. Remote images stay blocked until **Load images** on that message, unless Settings turns that on for every message.

## Shortcuts

| Key | Action |
| --- | --- |
| `Ctrl+K` | Command palette |
| `Ctrl+1`, `Ctrl+2` | Switch session |
| `C` | Compose |
| `R` | Reply |
| `E` | Archive |
| `#` | Delete |
| `J`, `K` | Next and previous message |
| `Ctrl+Enter` | Send |
| `Escape` | Close the palette, settings, or composer |

## Develop

From the repo root, `.\scripts\dev.ps1` installs the engine, starts it on port `8765` with token `dev-session-token`, and starts the UI at http://localhost:1420.

Engine tests, from `engine` after the virtualenv exists:

```powershell
.\.venv\Scripts\python.exe -m pytest
```

The desktop window needs Rust. Build the sidecar launcher once, then start Tauri while the engine is already running:

```powershell
.\scripts\prepare-dev-sidecar.ps1
cd desktop
npm run tauri dev
```

## Windows installer

`.\scripts\build-windows.ps1` freezes the engine with PyInstaller in onedir mode, builds the Rust launcher Tauri ships as a sidecar, and runs `npm run tauri build`. The NSIS installer is written under `desktop\src-tauri\target\release\bundle\nsis`. The packaged app starts the engine itself and does not use the dev token.
