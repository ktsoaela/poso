import 'dart:convert';
import 'dart:math';

import 'package:sqflite/sqflite.dart';

import 'models.dart';

/// The phone's mailbox. Every screen reads from here; IMAP only fills it in.
///
/// `folder_id` is where the user sees a message. `server_folder_id`/`server_uid` is where the
/// server last confirmed it, which is what queued changes act on when they are pushed.
class MailDb {
  MailDb._(this.db);

  final Database db;
  bool _fts = false;
  static const version = 1;

  static Future<MailDb> open(String path, {DatabaseFactory? factory}) async {
    final f = factory ?? databaseFactory;
    final db = await f.openDatabase(
      path,
      options: OpenDatabaseOptions(
        version: version,
        onConfigure: (db) => db.execute('PRAGMA foreign_keys = ON'),
        onCreate: (db, _) => _create(db),
      ),
    );
    final store = MailDb._(db);
    store._fts = (Sqflite.firstIntValue(await db.rawQuery("SELECT COUNT(*) FROM sqlite_master WHERE name = 'message_fts'")) ?? 0) > 0;
    await store._seedSessions();
    return store;
  }

  static Future<void> _create(Database db) async {
    final batch = db.batch();
    batch.execute('''
      CREATE TABLE sessions(
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#4f46e5',
        sort_order INTEGER NOT NULL DEFAULT 0)''');
    batch.execute('''
      CREATE TABLE accounts(
        id INTEGER PRIMARY KEY,
        session_id INTEGER NOT NULL REFERENCES sessions(id),
        email TEXT NOT NULL, username TEXT NOT NULL DEFAULT '', display_name TEXT NOT NULL DEFAULT '',
        provider TEXT NOT NULL DEFAULT 'custom',
        imap_host TEXT NOT NULL, imap_port INTEGER NOT NULL DEFAULT 993, imap_ssl INTEGER NOT NULL DEFAULT 1,
        smtp_host TEXT NOT NULL, smtp_port INTEGER NOT NULL DEFAULT 587, smtp_mode TEXT NOT NULL DEFAULT 'starttls',
        color TEXT NOT NULL DEFAULT '#4f46e5', last_sync_at INTEGER, last_error TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL)''');
    batch.execute('''
      CREATE TABLE folders(
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        path TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'custom',
        uidvalidity INTEGER NOT NULL DEFAULT 0, highest_uid INTEGER NOT NULL DEFAULT 0,
        offline INTEGER NOT NULL DEFAULT 0, sync INTEGER NOT NULL DEFAULT 1,
        UNIQUE(account_id, path))''');
    batch.execute('''
      CREATE TABLE messages(
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
        server_folder_id INTEGER NOT NULL,
        server_uid INTEGER NOT NULL DEFAULT 0,
        message_id TEXT NOT NULL DEFAULT '', thread_id TEXT NOT NULL DEFAULT '',
        subject TEXT NOT NULL DEFAULT '', from_name TEXT NOT NULL DEFAULT '', from_email TEXT NOT NULL DEFAULT '',
        to_json TEXT NOT NULL DEFAULT '[]', cc_json TEXT NOT NULL DEFAULT '[]',
        date INTEGER, snippet TEXT NOT NULL DEFAULT '', body_text TEXT NOT NULL DEFAULT '', body_html TEXT NOT NULL DEFAULT '',
        has_body INTEGER NOT NULL DEFAULT 0,
        seen INTEGER NOT NULL DEFAULT 0, flagged INTEGER NOT NULL DEFAULT 0, answered INTEGER NOT NULL DEFAULT 0,
        size INTEGER NOT NULL DEFAULT 0, in_reply_to TEXT NOT NULL DEFAULT '', references_json TEXT NOT NULL DEFAULT '[]',
        pending INTEGER NOT NULL DEFAULT 0)''');
    batch.execute('CREATE INDEX messages_folder ON messages(folder_id, date DESC)');
    batch.execute('CREATE INDEX messages_server ON messages(server_folder_id, server_uid)');
    batch.execute('CREATE INDEX messages_msgid ON messages(message_id)');
    batch.execute('''
      CREATE TABLE attachments(
        id INTEGER PRIMARY KEY,
        message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        filename TEXT NOT NULL, mime TEXT NOT NULL DEFAULT 'application/octet-stream',
        size INTEGER NOT NULL DEFAULT 0, path TEXT NOT NULL DEFAULT '')''');
    batch.execute('''
      CREATE TABLE drafts(
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        message_id TEXT NOT NULL,
        to_text TEXT NOT NULL DEFAULT '', cc_text TEXT NOT NULL DEFAULT '', bcc_text TEXT NOT NULL DEFAULT '',
        subject TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
        in_reply_to TEXT NOT NULL DEFAULT '', references_json TEXT NOT NULL DEFAULT '[]',
        server_uid INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)''');
    batch.execute('''
      CREATE TABLE labels(
        id INTEGER PRIMARY KEY,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#6366f1', UNIQUE(session_id, name))''');
    batch.execute('''
      CREATE TABLE message_labels(
        message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
        PRIMARY KEY(message_id, label_id))''');
    batch.execute('''
      CREATE TABLE outbox(
        id INTEGER PRIMARY KEY,
        client_id TEXT NOT NULL UNIQUE,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        message_id INTEGER,
        op TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)''');
    batch.execute('''
      CREATE TABLE audit_log(
        id INTEGER PRIMARY KEY, at INTEGER NOT NULL, session_id INTEGER, account_id INTEGER,
        action TEXT NOT NULL, target TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '')''');
    await batch.commit(noResult: true);
    await _createSearch(db);
  }

  /// Android's SQLite always has FTS4; other builds may only have FTS5. Both accept the same
  /// `MATCH 'word*'` queries and rowid triggers. Without either, search falls back to LIKE.
  static Future<void> _createSearch(Database db) async {
    for (final module in ['fts4(subject, sender, recipients, body, tokenize=unicode61)', "fts5(subject, sender, recipients, body, tokenize='unicode61')"]) {
      try {
        await db.execute('CREATE VIRTUAL TABLE message_fts USING $module');
      } on DatabaseException {
        continue;
      }
      await db.execute('''
        CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
          INSERT INTO message_fts(rowid, subject, sender, recipients, body)
          VALUES (new.id, new.subject, new.from_name || ' ' || new.from_email, new.to_json || ' ' || new.cc_json, new.body_text);
        END''');
      await db.execute('''
        CREATE TRIGGER messages_au AFTER UPDATE OF subject, from_name, from_email, to_json, cc_json, body_text ON messages BEGIN
          DELETE FROM message_fts WHERE rowid = old.id;
          INSERT INTO message_fts(rowid, subject, sender, recipients, body)
          VALUES (new.id, new.subject, new.from_name || ' ' || new.from_email, new.to_json || ' ' || new.cc_json, new.body_text);
        END''');
      await db.execute('CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN DELETE FROM message_fts WHERE rowid = old.id; END');
      return;
    }
  }

  /// Business and Personal exist from the first run and start empty.
  Future<void> _seedSessions() async {
    final count = Sqflite.firstIntValue(await db.rawQuery('SELECT COUNT(*) FROM sessions')) ?? 0;
    if (count > 0) return;
    await db.insert('sessions', {'name': 'Business', 'color': '#4f46e5', 'sort_order': 0});
    await db.insert('sessions', {'name': 'Personal', 'color': '#e11d48', 'sort_order': 1});
  }

  Future<void> close() => db.close();

  static int now() => DateTime.now().millisecondsSinceEpoch;

  static String newClientId() {
    final rand = Random.secure();
    final bytes = List<int>.generate(9, (_) => rand.nextInt(256));
    return '${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}-${base64Url.encode(bytes).replaceAll('=', '')}';
  }

  // ---------------------------------------------------------------- sessions & accounts

  Future<List<MailSessionRow>> sessions() async =>
      (await db.query('sessions', orderBy: 'sort_order, id')).map(MailSessionRow.fromRow).toList();

  Future<List<Account>> accounts({int? sessionId}) async => (await db.query(
        'accounts',
        where: sessionId == null ? null : 'session_id = ?',
        whereArgs: sessionId == null ? null : [sessionId],
        orderBy: 'id',
      ))
          .map(Account.fromRow)
          .toList();

  Future<Account?> account(int id) async {
    final rows = await db.query('accounts', where: 'id = ?', whereArgs: [id]);
    return rows.isEmpty ? null : Account.fromRow(rows.first);
  }

  Future<int> insertAccount(Map<String, Object?> values) => db.insert('accounts', {...values, 'created_at': now()});

  Future<void> deleteAccount(int id) => db.delete('accounts', where: 'id = ?', whereArgs: [id]);

  Future<void> setAccountSync(int id, {String error = ''}) => db.update(
        'accounts',
        {if (error.isEmpty) 'last_sync_at': now(), 'last_error': error},
        where: 'id = ?',
        whereArgs: [id],
      );

  // ---------------------------------------------------------------- folders

  Future<List<Folder>> folders(List<int> accountIds) async {
    if (accountIds.isEmpty) return [];
    final marks = List.filled(accountIds.length, '?').join(',');
    final rows = await db.rawQuery('''
      SELECT f.*, (SELECT COUNT(*) FROM messages m WHERE m.folder_id = f.id AND m.seen = 0) AS unread
      FROM folders f WHERE f.account_id IN ($marks) ORDER BY f.account_id, f.path''', accountIds);
    return rows.map(Folder.fromRow).toList();
  }

  Future<Folder?> folder(int id) async {
    final rows = await db.rawQuery('SELECT f.*, 0 AS unread FROM folders f WHERE id = ?', [id]);
    return rows.isEmpty ? null : Folder.fromRow(rows.first);
  }

  Future<Folder?> folderByRole(int accountId, String role) async {
    final rows = await db.rawQuery('SELECT f.*, 0 AS unread FROM folders f WHERE account_id = ? AND role = ? ORDER BY id LIMIT 1', [accountId, role]);
    return rows.isEmpty ? null : Folder.fromRow(rows.first);
  }

  Future<int> upsertFolder(int accountId, String path, String name, String role, {bool sync = true}) async {
    final rows = await db.query('folders', columns: ['id'], where: 'account_id = ? AND path = ?', whereArgs: [accountId, path]);
    if (rows.isNotEmpty) {
      final id = rows.first['id'] as int;
      await db.update('folders', {'name': name, 'role': role, 'sync': sync ? 1 : 0}, where: 'id = ?', whereArgs: [id]);
      return id;
    }
    return db.insert('folders', {'account_id': accountId, 'path': path, 'name': name, 'role': role, 'sync': sync ? 1 : 0});
  }

  Future<Map<String, Object?>> folderState(int id) async => (await db.query('folders', where: 'id = ?', whereArgs: [id])).first;

  Future<void> setFolderState(int id, {required int uidvalidity, required int highestUid}) =>
      db.update('folders', {'uidvalidity': uidvalidity, 'highest_uid': highestUid}, where: 'id = ?', whereArgs: [id]);

  Future<void> setFolderOffline(int id, bool offline) =>
      db.update('folders', {'offline': offline ? 1 : 0}, where: 'id = ?', whereArgs: [id]);

  /// Drops every confirmed copy in a folder whose UIDVALIDITY changed; pending local changes stay.
  Future<void> resetFolder(int id) async {
    await db.delete('messages', where: 'server_folder_id = ? AND pending = 0', whereArgs: [id]);
    await db.update('messages', {'server_uid': 0}, where: 'server_folder_id = ?', whereArgs: [id]);
  }

  // ---------------------------------------------------------------- messages

  static const _listColumns = '''
    m.id, m.account_id, m.folder_id, m.server_folder_id, m.server_uid, m.message_id, m.thread_id, m.subject,
    m.from_name, m.from_email, m.to_json, m.cc_json, m.date, m.snippet, '' AS body_text, '' AS body_html, m.has_body,
    m.seen, m.flagged, m.answered, m.size, m.in_reply_to, m.references_json, m.pending,
    f.role AS folder_role, a.email AS account_email, a.color AS account_color''';

  /// Lists a role across every account in the session (unified Inbox), or one folder.
  Future<List<Message>> listMessages({
    required int sessionId,
    String? role,
    int? folderId,
    int? accountId,
    bool flaggedOnly = false,
    int limit = 200,
    int offset = 0,
  }) async {
    final where = <String>['a.session_id = ?'];
    final args = <Object?>[sessionId];
    if (folderId != null) {
      where.add('m.folder_id = ?');
      args.add(folderId);
    } else if (flaggedOnly) {
      where.add("m.flagged = 1 AND f.role NOT IN ('trash', 'spam')");
    } else if (role != null) {
      where.add('f.role = ?');
      args.add(role);
    }
    if (accountId != null) {
      where.add('m.account_id = ?');
      args.add(accountId);
    }
    // Local drafts are listed from the drafts table; hide their server copies so they don't show twice.
    where.add("(m.message_id = '' OR m.message_id NOT IN (SELECT message_id FROM drafts))");
    final rows = await db.rawQuery('''
      SELECT $_listColumns FROM messages m
      JOIN folders f ON f.id = m.folder_id JOIN accounts a ON a.id = m.account_id
      WHERE ${where.join(' AND ')}
      ORDER BY m.date DESC, m.id DESC LIMIT ? OFFSET ?''', [...args, limit, offset]);
    return rows.map(Message.fromRow).toList();
  }

  /// Full-text search inside one session. Every word must match (prefix match).
  Future<List<Message>> search(int sessionId, String query, {int limit = 200}) async {
    final terms = RegExp(r'[\p{L}\p{N}@._-]+', unicode: true)
        .allMatches(query.toLowerCase())
        .map((m) => m.group(0)!.replaceAll(RegExp(r'[._@-]+'), ' ').trim())
        .expand((t) => t.split(' '))
        .where((t) => t.isNotEmpty)
        .toList();
    if (terms.isEmpty) return [];
    final String filter;
    final List<Object?> args;
    if (_fts) {
      filter = 'm.id IN (SELECT rowid FROM message_fts WHERE message_fts MATCH ?)';
      args = [terms.map((t) => '"$t"*').join(' ')];
    } else {
      const haystack = "lower(m.subject || ' ' || m.from_name || ' ' || m.from_email || ' ' || m.to_json || ' ' || m.body_text)";
      // Terms are letters and digits only (see above), so they hold no LIKE wildcards.
      filter = terms.map((_) => '$haystack LIKE ?').join(' AND ');
      args = terms.map((t) => '%$t%').toList();
    }
    final rows = await db.rawQuery('''
      SELECT $_listColumns FROM messages m
      JOIN folders f ON f.id = m.folder_id JOIN accounts a ON a.id = m.account_id
      WHERE a.session_id = ? AND $filter
      ORDER BY m.date DESC LIMIT ?''', [sessionId, ...args, limit]);
    return rows.map(Message.fromRow).toList();
  }

  Future<Message?> message(int id) async {
    final rows = await db.rawQuery('''
      SELECT m.*, f.role AS folder_role, a.email AS account_email, a.color AS account_color
      FROM messages m JOIN folders f ON f.id = m.folder_id JOIN accounts a ON a.id = m.account_id
      WHERE m.id = ?''', [id]);
    return rows.isEmpty ? null : Message.fromRow(rows.first);
  }

  Future<List<Attachment>> attachments(int messageId) async =>
      (await db.query('attachments', where: 'message_id = ?', whereArgs: [messageId])).map(Attachment.fromRow).toList();

  Future<Map<String, Object?>?> byServer(int folderId, int uid) async {
    final rows = await db.query('messages',
        columns: ['id', 'pending', 'seen', 'flagged', 'answered'],
        where: 'server_folder_id = ? AND server_uid = ?',
        whereArgs: [folderId, uid],
        limit: 1);
    return rows.isEmpty ? null : rows.first;
  }

  /// A local copy waiting for its server UID (sent offline, moved without COPYUID).
  Future<int?> awaitingUid(int folderId, String messageId) async {
    if (messageId.isEmpty) return null;
    final rows = await db.query('messages',
        columns: ['id'], where: 'server_folder_id = ? AND server_uid = 0 AND message_id = ?', whereArgs: [folderId, messageId], limit: 1);
    return rows.isEmpty ? null : rows.first['id'] as int;
  }

  Future<List<int>> serverUids(int folderId) async => (await db.query('messages',
          columns: ['server_uid'], where: 'server_folder_id = ? AND server_uid > 0', whereArgs: [folderId]))
      .map((r) => r['server_uid'] as int)
      .toList();

  Future<int> removeVanished(int folderId, Set<int> uids) async {
    if (uids.isEmpty) return 0;
    var removed = 0;
    for (final chunk in _chunks(uids.toList(), 400)) {
      final marks = List.filled(chunk.length, '?').join(',');
      removed += await db.delete('messages',
          where: 'server_folder_id = ? AND pending = 0 AND server_uid IN ($marks)', whereArgs: [folderId, ...chunk]);
    }
    return removed;
  }

  Future<List<Map<String, Object?>>> missingBodies(int folderId, int limit) => db.query('messages',
      columns: ['id'], where: 'folder_id = ? AND has_body = 0 AND server_uid > 0', whereArgs: [folderId], orderBy: 'date DESC', limit: limit);

  Future<int> insertMessage(Map<String, Object?> values) => db.insert('messages', values);

  Future<void> updateMessage(int id, Map<String, Object?> values) => db.update('messages', values, where: 'id = ?', whereArgs: [id]);

  Future<void> saveBody(int id, {required String text, required String html, required List<Map<String, Object?>> attachments}) async {
    await db.transaction((txn) async {
      final snippet = text.replaceAll(RegExp(r'\s+'), ' ').trim();
      await txn.update('messages', {
        'body_text': text,
        'body_html': html,
        'has_body': 1,
        'snippet': snippet.length > 200 ? snippet.substring(0, 200) : snippet,
      }, where: 'id = ?', whereArgs: [id]);
      await txn.delete('attachments', where: 'message_id = ?', whereArgs: [id]);
      for (final item in attachments) {
        await txn.insert('attachments', {...item, 'message_id': id});
      }
    });
  }

  Future<List<String>> attachmentPathsForAccount(int accountId) async => (await db.rawQuery(
          'SELECT t.path FROM attachments t JOIN messages m ON m.id = t.message_id WHERE m.account_id = ?', [accountId]))
      .map((r) => r['path'] as String)
      .where((p) => p.isNotEmpty)
      .toList();

  // ---------------------------------------------------------------- outbox

  /// Records a change for the server. Bumps the message's pending count in the same
  /// transaction as the caller's local edit, so sync never overwrites it with an older copy.
  Future<String> enqueue(Transaction txn, {required int accountId, int? messageId, required String op, required Map<String, dynamic> payload}) async {
    final clientId = newClientId();
    await txn.insert('outbox', {
      'client_id': clientId,
      'account_id': accountId,
      'message_id': messageId,
      'op': op,
      'payload_json': jsonEncode(payload),
      'created_at': now(),
    });
    if (messageId != null) {
      await txn.rawUpdate('UPDATE messages SET pending = pending + 1 WHERE id = ?', [messageId]);
    }
    return clientId;
  }

  Future<List<OutboxItem>> outbox({String? status}) async => (await db.query('outbox',
          where: status == null ? null : 'status = ?', whereArgs: status == null ? null : [status], orderBy: 'id'))
      .map(OutboxItem.fromRow)
      .toList();

  Future<int> outboxCount() async => Sqflite.firstIntValue(await db.rawQuery("SELECT COUNT(*) FROM outbox WHERE status = 'pending'")) ?? 0;

  Future<int> failedCount() async => Sqflite.firstIntValue(await db.rawQuery("SELECT COUNT(*) FROM outbox WHERE status = 'failed'")) ?? 0;

  Future<void> completeOutbox(OutboxItem item) => db.transaction((txn) async {
        await txn.delete('outbox', where: 'id = ?', whereArgs: [item.id]);
        if (item.messageId != null) {
          await txn.rawUpdate('UPDATE messages SET pending = MAX(pending - 1, 0) WHERE id = ?', [item.messageId]);
        }
      });

  Future<void> noteAttempt(OutboxItem item, String error) =>
      db.rawUpdate('UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?', [error, item.id]);

  /// Gives up on a change the server refused. The message stops being "pending" so the
  /// next sync can bring back the server's version.
  Future<void> failOutbox(OutboxItem item, String error) => db.transaction((txn) async {
        await txn.update('outbox', {'status': 'failed', 'last_error': error}, where: 'id = ?', whereArgs: [item.id]);
        if (item.messageId != null) {
          await txn.rawUpdate('UPDATE messages SET pending = MAX(pending - 1, 0) WHERE id = ?', [item.messageId]);
        }
      });

  Future<void> retryOutbox(int id) => db.transaction((txn) async {
        final rows = await txn.query('outbox', where: 'id = ?', whereArgs: [id]);
        if (rows.isEmpty) return;
        final item = OutboxItem.fromRow(rows.first);
        await txn.update('outbox', {'status': 'pending', 'last_error': ''}, where: 'id = ?', whereArgs: [id]);
        if (item.messageId != null) await txn.rawUpdate('UPDATE messages SET pending = pending + 1 WHERE id = ?', [item.messageId]);
      });

  Future<void> discardOutbox(int id) => db.delete('outbox', where: "id = ? AND status = 'failed'", whereArgs: [id]);

  // ---------------------------------------------------------------- drafts

  Future<List<Draft>> drafts(int sessionId) async => (await db.rawQuery('''
        SELECT d.* FROM drafts d JOIN accounts a ON a.id = d.account_id
        WHERE a.session_id = ? ORDER BY d.updated_at DESC''', [sessionId]))
      .map(Draft.fromRow)
      .toList();

  Future<Draft?> draft(int id) async {
    final rows = await db.query('drafts', where: 'id = ?', whereArgs: [id]);
    return rows.isEmpty ? null : Draft.fromRow(rows.first);
  }

  // ---------------------------------------------------------------- audit

  /// Append-only. Never pass secrets here.
  Future<void> audit(DatabaseExecutor exec, String action, {int? sessionId, int? accountId, String target = '', String detail = ''}) =>
      exec.insert('audit_log', {
        'at': now(),
        'session_id': sessionId,
        'account_id': accountId,
        'action': action,
        'target': target.length > 500 ? target.substring(0, 500) : target,
        'detail': detail,
      });

  static Iterable<List<T>> _chunks<T>(List<T> items, int size) sync* {
    for (var i = 0; i < items.length; i += size) {
      yield items.sublist(i, min(i + size, items.length));
    }
  }
}
