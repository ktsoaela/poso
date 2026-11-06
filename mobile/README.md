# Poso for Android

An offline-first mail client for the phone. It syncs IMAP itself and does not need the desktop engine.

- **Screens read only the local SQLite mailbox.** Inbox, folders, the reader and search all work with no network.
- **IMAP is the sync.** Headers sync first. Bodies and attachments download when you open a message, or ahead of time for folders you mark *Available offline* in Settings.
- **Offline changes go to an outbox.** Read, unread, flag, move, delete, draft and send apply to SQLite at once. They are pushed in order when the device is back online. A message with a pending change keeps it, even if the server sends an older copy first.
- **Sessions.** Business and Personal exist from the first run. Accounts, folders, search and labels stay inside the active session, the same as on the desktop.
- **Secrets.** Passwords are kept in Android Keystore (`flutter_secure_storage`), never in SQLite, Hive, logs or the audit log.

## Layout

| Path | What it is |
| --- | --- |
| `lib/data/db.dart` | SQLite schema and queries: sessions, accounts, folders, messages, attachments, drafts, labels, outbox, audit, full-text search |
| `lib/services/sync_engine.dart` | Header sync, body download, outbox push |
| `lib/services/transport.dart` | `MailServer`/`MailConnector` interface, plus the IMAP/SMTP implementation on `enough_mail` |
| `lib/services/mailbox.dart` | What the UI calls. Local edit + outbox entry in one transaction |
| `lib/services/offline_store.dart` | Hive settings: active session, last view |
| `lib/services/secret_store.dart` | Keystore passwords |
| `test/` | Tests against an in-memory fake IMAP/SMTP server |

## Build and run

Flutter is in `%USERPROFILE%\flutter`. Use Android Studio's JDK.

```powershell
$env:Path = "$env:USERPROFILE\flutter\bin;$env:Path"
$env:JAVA_HOME = "$env:LOCALAPPDATA\Programs\Android Studio\jbr"
cd mobile
flutter pub get
flutter test
flutter build apk --release      # build\app\outputs\flutter-apk\app-release.apk
```

To run on an emulator, first create one. In Android Studio: **Device Manager → Create device**, for example Pixel 8 with an API 35 image. Then:

```powershell
flutter emulators                         # list them
flutter emulators --launch <emulator id>
flutter run                               # debug build on the running emulator
```

Or install the built APK with `adb install -r build\app\outputs\flutter-apk\app-release.apk`.

**Gmail:** turn on 2-Step Verification, create an app password (Google Account → Security → App passwords), and enter the 16 letters as the password. Spaces are ignored.

The release APK is signed with the debug key. Add your own keystore before publishing to a store.
