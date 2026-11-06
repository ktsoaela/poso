import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:hive/hive.dart';
import 'package:poso/data/db.dart';
import 'package:poso/services/mailbox.dart';
import 'package:poso/services/offline_store.dart';
import 'package:poso/services/secret_store.dart';
import 'package:poso/services/sync_engine.dart';
import 'package:poso/services/transport.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'fake_server.dart';

class Harness {
  Harness._(this.dir, this.db, this.server, this.secrets, this.mailbox, this.sync);

  final Directory dir;
  final MailDb db;
  final FakeAccountServer server;
  final MemorySecretStore secrets;
  final Mailbox mailbox;
  final SyncEngine sync;
  bool online = true;

  static Future<Harness> create({FakeAccountServer? server, String dbPath = inMemoryDatabasePath}) async {
    final dir = await Directory.systemTemp.createTemp('poso_test');
    Hive.init(dir.path);
    final store = OfflineStore.withBox(await Hive.openBox('settings_${dir.path.hashCode}'));
    final db = await MailDb.open(dbPath, factory: databaseFactoryFfi);
    final fake = server ?? FakeAccountServer();
    final secrets = MemorySecretStore();
    final sync = SyncEngine(db, secrets, fake, dir.path);
    late Harness h;
    final mailbox = Mailbox(db: db, store: store, secrets: secrets, connector: fake, sync: sync, isOnline: () => h.online);
    h = Harness._(dir, db, fake, secrets, mailbox, sync);
    await mailbox.init();
    return h;
  }

  Future<int> addAccount({int? sessionId, String email = 'me@example.com'}) async {
    final account = await mailbox.addAccount(AccountInput(
      sessionId: sessionId ?? mailbox.sessionId,
      email: email,
      password: 'secret',
      displayName: 'Me',
      provider: 'custom',
      imapHost: 'imap.example.com',
      imapPort: 993,
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpMode: 'starttls',
    ));
    await mailbox.refresh();
    return account.id;
  }

  void goOffline() {
    online = false;
    server.offline = true;
  }

  Future<void> goOnline() async {
    online = true;
    server.offline = false;
    await mailbox.refresh();
  }

  Future<void> dispose() async {
    mailbox.dispose();
    await db.close();
    await Hive.close();
    try {
      await dir.delete(recursive: true);
    } catch (_) {}
  }
}

void main() {
  sqfliteFfiInit();
  Harness? current;
  late Harness h;

  tearDown(() async {
    await current?.dispose();
    current = null;
  });

  test('Business and Personal exist from the first run and start empty', () async {
    h = current = await Harness.create();
    expect((await h.db.sessions()).map((s) => s.name), ['Business', 'Personal']);
    expect(await h.db.accounts(), isEmpty);
    expect(await h.db.listMessages(sessionId: h.mailbox.sessionId, role: 'inbox'), isEmpty);
  });

  test('a wrong password is rejected and nothing is saved', () async {
    h = current = await Harness.create();
    h.server.password = 'other';
    await expectLater(h.addAccount(), throwsA(anything));
    expect(await h.db.accounts(), isEmpty);
    expect(h.secrets.values, isEmpty);
  });

  test('headers sync into SQLite; inbox, folders and search keep working offline', () async {
    h = current = await Harness.create();
    h.server.inbox.add('Dock ledger for March', text: 'Totals attached');
    h.server.inbox.add('Lunch on Friday?');
    await h.addAccount();

    expect(h.mailbox.messages.map((m) => m.subject), containsAll(['Dock ledger for March', 'Lunch on Friday?']));
    expect(h.mailbox.folders.map((f) => f.role), containsAll(['inbox', 'sent', 'drafts', 'archive', 'trash', 'spam']));
    // The password is in the secret store, never in SQLite or the audit log.
    final audit = await h.db.db.query('audit_log');
    expect(audit.map((r) => r['action']), contains('account.add'));
    expect(audit.toString().contains('secret'), isFalse);

    h.goOffline();
    await h.mailbox.reload();
    expect(h.mailbox.messages, hasLength(2));
    final found = await h.mailbox.search('ledger');
    expect(found.single.subject, 'Dock ledger for March');
  });

  test('search stays inside the active session', () async {
    h = current = await Harness.create();
    h.server.inbox.add('Invoice zephyr');
    final sessions = await h.db.sessions();
    await h.addAccount(sessionId: sessions[1].id); // Personal
    expect(await h.db.search(sessions[1].id, 'zephyr'), hasLength(1));
    expect(await h.db.search(sessions[0].id, 'zephyr'), isEmpty);
  });

  test('opening a message downloads its body and attachments once, then reads offline', () async {
    h = current = await Harness.create();
    h.server.inbox.add('Report', text: 'Numbers inside', attachments: [RemoteAttachment('q3.csv', 'text/csv', Uint8List.fromList('a,b\n1,2'.codeUnits))]);
    await h.addAccount();
    final id = h.mailbox.messages.single.id;
    final opened = await h.mailbox.open(id);
    expect(opened!.bodyText, 'Numbers inside');
    final files = await h.mailbox.attachments(id);
    expect(files.single.filename, 'q3.csv');
    expect(File(files.single.path).readAsStringSync(), 'a,b\n1,2');

    h.goOffline();
    final again = await h.mailbox.open(id);
    expect(again!.bodyText, 'Numbers inside');
    expect(await h.mailbox.search('numbers'), hasLength(1));
  });

  test('read and flag offline apply at once, survive an older server copy, and sync later', () async {
    h = current = await Harness.create();
    final remote = h.server.inbox.add('Standup notes');
    await h.addAccount();
    final id = h.mailbox.messages.single.id;

    h.goOffline();
    await h.mailbox.setSeen([id], true);
    await h.mailbox.setFlagged([id], true);
    var row = await h.db.message(id);
    expect(row!.seen && row.flagged, isTrue);
    expect(row.pending, 2);
    expect(h.mailbox.pendingCount, 2);

    // A sync that only pulls (server still says unread) must not undo the local change.
    h.server.offline = false;
    await h.sync.syncAccount((await h.db.accounts()).single);
    row = await h.db.message(id);
    expect(row!.seen && row.flagged, isTrue);

    await h.goOnline();
    expect(remote.seen && remote.flagged, isTrue);
    expect((await h.db.message(id))!.pending, 0);
    expect(h.mailbox.pendingCount, 0);
  });

  test('changes made on the server show up when nothing is pending', () async {
    h = current = await Harness.create();
    final remote = h.server.inbox.add('Read elsewhere');
    await h.addAccount();
    remote.seen = true;
    await h.mailbox.refresh();
    expect(h.mailbox.messages.single.seen, isTrue);
  });

  test('move offline, push later; no duplicate even without COPYUID', () async {
    h = current = await Harness.create(server: FakeAccountServer(supportsUidPlus: false));
    h.server.inbox.add('Archive me');
    await h.addAccount();
    final id = h.mailbox.messages.single.id;

    h.goOffline();
    expect(await h.mailbox.moveToRole([id], 'archive'), 1);
    expect(h.mailbox.messages, isEmpty); // gone from Inbox right away
    await h.mailbox.setView(const MailView.role('archive'));
    expect(h.mailbox.messages.single.id, id);
    // Flag it while the move is still queued: it must follow the message to Archive.
    await h.mailbox.setFlagged([id], true);

    await h.goOnline();
    expect(h.server.inbox.messages, isEmpty);
    final archived = h.server.folders['Archive']!.messages.values.single;
    expect(archived.flagged, isTrue);
    await h.mailbox.refresh();
    await h.mailbox.setView(const MailView.role('archive'));
    expect(h.mailbox.messages, hasLength(1));
    expect(h.mailbox.messages.single.id, id);
  });

  test('delete goes to Trash, then forever from Trash', () async {
    h = current = await Harness.create();
    h.server.inbox.add('Spammy');
    await h.addAccount();
    final id = h.mailbox.messages.single.id;
    await h.mailbox.delete([id]);
    await h.mailbox.refresh();
    expect(h.server.folders['Trash']!.messages, hasLength(1));

    await h.mailbox.setView(const MailView.role('trash'));
    final trashed = h.mailbox.messages.single.id;
    h.goOffline();
    await h.mailbox.delete([trashed]);
    expect(h.mailbox.messages, isEmpty);
    await h.goOnline();
    expect(h.server.folders['Trash']!.messages, isEmpty);
  });

  test('send offline: shows in Sent at once, leaves when back online, no duplicate after sync', () async {
    h = current = await Harness.create();
    await h.addAccount();
    final account = (await h.db.accounts()).single;

    h.goOffline();
    await h.mailbox.send(ComposeInput(accountId: account.id, to: 'Sam <sam@example.org>', subject: 'Contract', body: 'Signed copy tomorrow.'));
    expect(h.server.sent, isEmpty);
    expect(h.mailbox.pendingCount, 1);
    await h.mailbox.setView(const MailView.role('sent'));
    expect(h.mailbox.messages.single.subject, 'Contract');

    await h.goOnline();
    expect(h.server.sent.single.to.single.email, 'sam@example.org');
    expect(h.server.folders['Sent']!.messages, hasLength(1));
    await h.mailbox.refresh();
    await h.mailbox.setView(const MailView.role('sent'));
    expect(h.mailbox.messages, hasLength(1));
    expect(h.mailbox.pendingCount, 0);
  });

  test('sending validates recipients before queueing', () async {
    h = current = await Harness.create();
    await h.addAccount();
    final account = (await h.db.accounts()).single;
    await expectLater(h.mailbox.send(ComposeInput(accountId: account.id, to: 'not-an-address')), throwsA(isA<SyncException>()));
    expect(await h.db.outboxCount(), 0);
  });

  test('drafts save offline, replace their server copy, and are not listed twice', () async {
    h = current = await Harness.create();
    await h.addAccount();
    final account = (await h.db.accounts()).single;
    final input = ComposeInput(accountId: account.id, to: 'sam@example.org', subject: 'Plan', body: 'v1');

    h.goOffline();
    await h.mailbox.saveDraft(input);
    input.body = 'v2';
    await h.mailbox.saveDraft(input);
    expect(await h.db.outboxCount(), 1); // only the latest version is queued

    await h.goOnline();
    final drafts = h.server.folders['Drafts']!.messages.values.toList();
    expect(drafts.single.text, 'v2');

    input.body = 'v3';
    await h.mailbox.saveDraft(input);
    await h.mailbox.refresh();
    expect(h.server.folders['Drafts']!.messages.values.single.text, 'v3');

    await h.mailbox.setView(const MailView.role('drafts'));
    expect(h.mailbox.drafts, hasLength(1));
    expect(h.mailbox.messages, isEmpty); // the server copy is hidden behind the local draft

    await h.mailbox.send(input);
    await h.mailbox.refresh();
    expect(h.server.folders['Drafts']!.messages, isEmpty);
    expect(h.mailbox.drafts, isEmpty);
  });

  test('a change the server refuses is marked failed and stops blocking sync', () async {
    h = current = await Harness.create();
    final remote = h.server.inbox.add('Will vanish');
    await h.addAccount();
    final id = h.mailbox.messages.single.id;
    h.goOffline();
    await h.mailbox.setFlagged([id], true);
    h.server.inbox.messages.remove(remote.uid); // deleted on another device meanwhile
    h.online = true;
    h.server.offline = false;
    for (var i = 0; i < 3; i++) {
      await h.sync.flushOutbox();
    }
    expect(await h.db.failedCount(), 1);
    expect(await h.db.outboxCount(), 0);
    await h.mailbox.refresh();
    expect(h.mailbox.messages, isEmpty); // server truth wins once nothing is pending
  });

  test('the app reopens from local storage with no network', () async {
    final dir = await Directory.systemTemp.createTemp('poso_reopen');
    final path = '${dir.path}/mail.db';
    h = current = await Harness.create(dbPath: path);
    h.server.inbox.add('Kept on the phone');
    await h.addAccount();
    await h.mailbox.setFlagged([h.mailbox.messages.single.id], true);
    await h.dispose();

    // New process, no network at all.
    final server = FakeAccountServer()..offline = true;
    h = current = await Harness.create(server: server, dbPath: path);
    h.online = false;
    expect(h.mailbox.accounts.single.email, 'me@example.com');
    expect(h.mailbox.messages.single.subject, 'Kept on the phone');
    expect(isOfflineError(const SocketException('x')), isTrue);
  });
}
