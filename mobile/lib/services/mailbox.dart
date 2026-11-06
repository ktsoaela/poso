import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

import '../data/db.dart';
import '../data/models.dart';
import 'offline_store.dart';
import 'presets.dart';
import 'secret_store.dart';
import 'sync_engine.dart';
import 'transport.dart';

/// Which list the inbox screen shows.
class MailView {
  const MailView.role(this.role) : folderId = null;
  const MailView.folder(int this.folderId) : role = null;

  final String? role; // inbox, flagged, drafts, sent, archive, spam, trash
  final int? folderId;

  String get key => folderId != null ? 'folder:$folderId' : 'role:$role';

  static MailView parse(String key) {
    final parts = key.split(':');
    if (parts.length == 2 && parts[0] == 'folder') {
      final id = int.tryParse(parts[1]);
      if (id != null) return MailView.folder(id);
    }
    if (parts.length == 2 && parts[0] == 'role') return MailView.role(parts[1]);
    return const MailView.role('inbox');
  }

  @override
  bool operator ==(Object other) => other is MailView && other.key == key;
  @override
  int get hashCode => key.hashCode;
}

class AccountInput {
  AccountInput({
    required this.sessionId,
    required this.email,
    required this.password,
    required this.displayName,
    required this.provider,
    required this.imapHost,
    required this.imapPort,
    required this.smtpHost,
    required this.smtpPort,
    required this.smtpMode,
    this.username = '',
  });
  final int sessionId;
  final String email;
  final String password;
  final String displayName;
  final String provider;
  final String imapHost;
  final int imapPort;
  final String smtpHost;
  final int smtpPort;
  final String smtpMode;
  final String username;
}

class ComposeInput {
  ComposeInput({
    required this.accountId,
    this.to = '',
    this.cc = '',
    this.bcc = '',
    this.subject = '',
    this.body = '',
    this.inReplyTo = '',
    this.references = const [],
    this.draftId,
  });
  int accountId;
  String to;
  String cc;
  String bcc;
  String subject;
  String body;
  String inReplyTo;
  List<String> references;
  int? draftId;

  bool get isEmpty => to.trim().isEmpty && cc.trim().isEmpty && bcc.trim().isEmpty && subject.trim().isEmpty && body.trim().isEmpty;
}

const roleTitles = {
  'inbox': 'Inbox',
  'flagged': 'Flagged',
  'drafts': 'Drafts',
  'sent': 'Sent',
  'archive': 'Archive',
  'spam': 'Spam',
  'trash': 'Trash',
};

/// UI facade over the local mailbox. Every action edits SQLite first and queues the server
/// change in the same transaction; pushing happens in the background when online.
class Mailbox extends ChangeNotifier {
  Mailbox({
    required this.db,
    required this.store,
    required this.secrets,
    required this.connector,
    required this.sync,
    required this.isOnline,
  });

  final MailDb db;
  final OfflineStore store;
  final SecretStore secrets;
  final MailConnector connector;
  final SyncEngine sync;
  final bool Function() isOnline;

  List<MailSessionRow> sessions = [];
  MailSessionRow? activeSession;
  List<Account> accounts = [];
  List<Folder> folders = [];
  MailView view = const MailView.role('inbox');
  List<Message> messages = [];
  List<Draft> drafts = [];
  int pendingCount = 0;
  int failedCount = 0;
  bool syncing = false;
  String? syncError;
  Future<void>? _running;
  Timer? _kickTimer;
  Timer? _periodic;

  Future<void> init() async {
    sessions = await db.sessions();
    final saved = store.activeSessionId;
    activeSession = sessions.firstWhere((s) => s.id == saved, orElse: () => sessions.first);
    view = MailView.parse(store.lastView);
    await reload();
    _periodic = Timer.periodic(const Duration(minutes: 3), (_) => refresh(quiet: true));
  }

  @override
  void dispose() {
    _kickTimer?.cancel();
    _periodic?.cancel();
    super.dispose();
  }

  int get sessionId => activeSession!.id;

  String get title {
    if (view.folderId != null) {
      final folder = folders.where((f) => f.id == view.folderId).firstOrNull;
      return folder?.name ?? 'Folder';
    }
    return roleTitles[view.role] ?? 'Mail';
  }

  Account? accountById(int id) => accounts.where((a) => a.id == id).firstOrNull;

  int unreadFor(String role) => folders.where((f) => f.role == role).fold(0, (sum, f) => sum + f.unread);

  Future<void> reload() async {
    accounts = await db.accounts(sessionId: sessionId);
    folders = await db.folders(accounts.map((a) => a.id).toList());
    if (view.folderId != null && !folders.any((f) => f.id == view.folderId)) view = const MailView.role('inbox');
    drafts = await db.drafts(sessionId);
    if (view.role == 'drafts') {
      messages = await db.listMessages(sessionId: sessionId, role: 'drafts');
    } else if (view.role == 'flagged') {
      messages = await db.listMessages(sessionId: sessionId, flaggedOnly: true);
    } else {
      messages = await db.listMessages(sessionId: sessionId, role: view.role, folderId: view.folderId);
    }
    pendingCount = await db.outboxCount();
    failedCount = await db.failedCount();
    notifyListeners();
  }

  Future<void> switchSession(int id) async {
    activeSession = sessions.firstWhere((s) => s.id == id);
    store.activeSessionId = id;
    view = const MailView.role('inbox');
    store.lastView = view.key;
    await reload();
    unawaited(refresh(quiet: true));
  }

  Future<void> setView(MailView next) async {
    view = next;
    store.lastView = next.key;
    await reload();
  }

  // ----------------------------------------------------------------- sync

  /// Pushes queued changes, then pulls every account in the session. Safe to call often.
  Future<void> refresh({bool quiet = false}) {
    if (!isOnline() || accounts.isEmpty && pendingCount == 0) return Future.value();
    return _running ??= _refresh(quiet).whenComplete(() => _running = null);
  }

  Future<void> _refresh(bool quiet) async {
    syncing = true;
    syncError = null;
    notifyListeners();
    try {
      final flushed = await sync.flushOutbox();
      if (flushed.offline) return;
      for (final account in await db.accounts(sessionId: sessionId)) {
        try {
          await sync.syncAccount(account);
        } catch (e) {
          if (isOfflineError(e)) return;
          syncError = '${account.email}: $e';
        }
        await reload();
      }
      // Changes made while we were pulling.
      if (await db.outboxCount() > 0) await sync.flushOutbox();
    } finally {
      syncing = false;
      await reload();
    }
  }

  /// Push soon after a local change, batching quick taps.
  void _kick() {
    _kickTimer?.cancel();
    _kickTimer = Timer(const Duration(milliseconds: 600), () async {
      if (!isOnline()) return;
      if (_running != null) await _running;
      _running ??= (() async {
        syncing = true;
        notifyListeners();
        try {
          await sync.flushOutbox();
        } finally {
          syncing = false;
          await reload();
        }
      })()
          .whenComplete(() => _running = null);
    });
  }

  /// Called when connectivity returns.
  void onOnline() => refresh(quiet: true);

  // ----------------------------------------------------------------- accounts

  /// Checks the login against the server, then saves the account. Needs a connection.
  Future<Account> addAccount(AccountInput input) async {
    final email = input.email.trim();
    if (!RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email)) throw SyncException('Enter a full email address.');
    if (input.imapHost.trim().isEmpty || input.smtpHost.trim().isEmpty) {
      throw SyncException('Enter the IMAP and SMTP servers. Open Server settings if they were not filled in.');
    }
    final all = await db.accounts();
    if (all.any((a) => a.email.toLowerCase() == email.toLowerCase())) throw SyncException('$email is already on this phone.');
    final draft = Account(
      id: 0,
      sessionId: input.sessionId,
      email: email,
      username: input.username.trim(),
      displayName: input.displayName.trim(),
      provider: input.provider,
      imapHost: input.imapHost.trim(),
      imapPort: input.imapPort,
      imapSsl: true,
      smtpHost: input.smtpHost.trim(),
      smtpPort: input.smtpPort,
      smtpMode: input.smtpMode,
      color: accountColors[all.length % accountColors.length],
    );
    final server = await connector.open(draft, input.password); // throws on bad login
    await server.close();
    final id = await db.db.transaction((txn) async {
      final id = await txn.insert('accounts', {
        'session_id': draft.sessionId,
        'email': draft.email,
        'username': draft.username,
        'display_name': draft.displayName,
        'provider': draft.provider,
        'imap_host': draft.imapHost,
        'imap_port': draft.imapPort,
        'imap_ssl': 1,
        'smtp_host': draft.smtpHost,
        'smtp_port': draft.smtpPort,
        'smtp_mode': draft.smtpMode,
        'color': draft.color,
        'created_at': MailDb.now(),
      });
      await db.audit(txn, 'account.add', sessionId: draft.sessionId, accountId: id, target: draft.email);
      return id;
    });
    await secrets.savePassword(id, input.password);
    if (input.sessionId != sessionId) await switchSession(input.sessionId);
    await reload();
    unawaited(refresh());
    return (await db.account(id))!;
  }

  Future<void> removeAccount(int id) async {
    final account = await db.account(id);
    if (account == null) return;
    for (final path in await db.attachmentPathsForAccount(id)) {
      try {
        await File(path).delete();
      } catch (_) {}
    }
    await db.db.transaction((txn) async {
      await txn.delete('accounts', where: 'id = ?', whereArgs: [id]);
      await db.audit(txn, 'account.remove', sessionId: account.sessionId, accountId: id, target: account.email);
    });
    await secrets.delete(id);
    await reload();
  }

  // ----------------------------------------------------------------- reading

  /// Marks read and makes sure the body is local. Works offline for anything already downloaded.
  Future<Message?> open(int id) async {
    var message = await db.message(id);
    if (message == null) return null;
    if (!message.seen) await setSeen([id], true);
    if (!message.hasBody && isOnline()) {
      try {
        await sync.downloadBody(id);
      } catch (e) {
        if (!isOfflineError(e)) rethrow;
      }
    }
    message = await db.message(id);
    await reload();
    return message;
  }

  Future<List<Attachment>> attachments(int id) => db.attachments(id);

  Future<List<Message>> search(String query) => db.search(sessionId, query);

  // ----------------------------------------------------------------- local changes

  Future<void> setSeen(List<int> ids, bool seen) => _flags(ids, seen: seen);

  Future<void> setFlagged(List<int> ids, bool flagged) => _flags(ids, flagged: flagged);

  Future<void> _flags(List<int> ids, {bool? seen, bool? flagged}) async {
    await db.db.transaction((txn) async {
      for (final id in ids) {
        final rows = await txn.query('messages', columns: ['account_id', 'seen', 'flagged'], where: 'id = ?', whereArgs: [id]);
        if (rows.isEmpty) continue;
        final row = rows.first;
        final change = <String, Object?>{};
        final payload = <String, dynamic>{};
        if (seen != null && (row['seen'] == 1) != seen) {
          change['seen'] = seen ? 1 : 0;
          payload['seen'] = seen;
        }
        if (flagged != null && (row['flagged'] == 1) != flagged) {
          change['flagged'] = flagged ? 1 : 0;
          payload['flagged'] = flagged;
        }
        if (change.isEmpty) continue;
        await txn.update('messages', change, where: 'id = ?', whereArgs: [id]);
        await db.enqueue(txn, accountId: row['account_id'] as int, messageId: id, op: 'flags', payload: payload);
      }
    });
    await reload();
    _kick();
  }

  /// Moves to the same-named role folder of each message's own account.
  Future<int> moveToRole(List<int> ids, String role) async {
    var moved = 0;
    for (final id in ids) {
      final message = await db.message(id);
      if (message == null) continue;
      var target = await db.folderByRole(message.accountId, role);
      // Gmail archives by leaving only "All Mail".
      if (target == null && role == 'archive') target = await db.folderByRole(message.accountId, 'all');
      if (target == null || target.id == message.folderId) continue;
      await _move(message, target);
      moved++;
    }
    await reload();
    _kick();
    return moved;
  }

  Future<void> moveToFolder(int id, int folderId) async {
    final message = await db.message(id);
    final target = await db.folder(folderId);
    if (message == null || target == null || target.accountId != message.accountId || target.id == message.folderId) return;
    await _move(message, target);
    await reload();
    _kick();
  }

  Future<void> _move(Message message, Folder target) => db.db.transaction((txn) async {
        await txn.update('messages', {'folder_id': target.id}, where: 'id = ?', whereArgs: [message.id]);
        await db.enqueue(txn,
            accountId: message.accountId,
            messageId: message.id,
            op: 'move',
            payload: {'target_folder_id': target.id, 'target_name': target.name});
        await db.audit(txn, 'message.move', sessionId: sessionId, accountId: message.accountId, target: message.subject, detail: target.name);
      });

  /// Trash, or delete forever when already in Trash or Spam.
  Future<void> delete(List<int> ids) async {
    for (final id in ids) {
      final message = await db.message(id);
      if (message == null) continue;
      if (message.folderRole == 'trash' || message.folderRole == 'spam') {
        await _deleteForever(message);
      } else if (await db.folderByRole(message.accountId, 'trash') != null) {
        await moveToRole([id], 'trash');
      } else {
        await _deleteForever(message);
      }
    }
    await reload();
    _kick();
  }

  Future<void> _deleteForever(Message message) => db.db.transaction((txn) async {
        // Earlier queued edits to this message no longer matter.
        await txn.delete('outbox', where: "message_id = ? AND status = 'pending' AND op IN ('flags', 'move')", whereArgs: [message.id]);
        await db.enqueue(txn, accountId: message.accountId, op: 'delete', payload: {
          'folder_id': message.serverFolderId,
          'uid': message.serverUid,
          'message_id': message.messageId,
        });
        await txn.delete('messages', where: 'id = ?', whereArgs: [message.id]);
        await db.audit(txn, 'message.delete', sessionId: sessionId, accountId: message.accountId, target: message.subject);
      });

  // ----------------------------------------------------------------- drafts & sending

  String _newMessageId() => '<${MailDb.newClientId()}@poso.app>';

  /// Saves locally at once; the server copy in Drafts follows when online.
  Future<int?> saveDraft(ComposeInput input) async {
    if (input.isEmpty) {
      if (input.draftId != null) await deleteDraft(input.draftId!);
      return null;
    }
    final id = await db.db.transaction((txn) async {
      final values = {
        'account_id': input.accountId,
        'to_text': input.to,
        'cc_text': input.cc,
        'bcc_text': input.bcc,
        'subject': input.subject,
        'body': input.body,
        'in_reply_to': input.inReplyTo,
        'references_json': jsonEncode(input.references),
        'updated_at': MailDb.now(),
      };
      int id;
      final existing = input.draftId == null ? const [] : await txn.query('drafts', where: 'id = ?', whereArgs: [input.draftId]);
      if (existing.isNotEmpty) {
        id = input.draftId!;
        await txn.update('drafts', values, where: 'id = ?', whereArgs: [id]);
      } else {
        id = await txn.insert('drafts', {...values, 'message_id': _newMessageId()});
      }
      // Only the latest version needs to reach the server.
      await txn.delete('outbox', where: "op = 'draft' AND status = 'pending' AND payload_json = ?", whereArgs: [jsonEncode({'draft_id': id})]);
      await db.enqueue(txn, accountId: input.accountId, op: 'draft', payload: {'draft_id': id});
      return id;
    });
    input.draftId = id;
    await reload();
    _kick();
    return id;
  }

  Future<void> deleteDraft(int id, {bool reloadAfter = true}) async {
    await db.db.transaction((txn) async {
      final rows = await txn.query('drafts', where: 'id = ?', whereArgs: [id]);
      if (rows.isEmpty) return;
      final draft = Draft.fromRow(rows.first);
      await txn.delete('drafts', where: 'id = ?', whereArgs: [id]);
      await txn.delete('outbox', where: "op = 'draft' AND status = 'pending' AND payload_json = ?", whereArgs: [jsonEncode({'draft_id': id})]);
      await db.enqueue(txn, accountId: draft.accountId, op: 'draft_delete', payload: {'message_id': draft.messageId, 'server_uid': draft.serverUid});
    });
    if (reloadAfter) {
      await reload();
      _kick();
    }
  }

  /// Queues the message and shows it in Sent right away. It leaves the phone when online.
  Future<void> send(ComposeInput input) async {
    final to = Address.parseList(input.to);
    final all = [...to, ...Address.parseList(input.cc), ...Address.parseList(input.bcc)];
    if (all.isEmpty) throw SyncException('Add at least one recipient.');
    final bad = all.where((a) => !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(a.email)).map((a) => a.email).toList();
    if (bad.isNotEmpty) throw SyncException('“${bad.first}” isn’t a valid email address.');
    final account = await db.account(input.accountId);
    if (account == null) throw SyncException('Choose an account to send from.');
    final messageId = _newMessageId();
    final now = MailDb.now();
    final sent = await db.folderByRole(account.id, 'sent');
    await db.db.transaction((txn) async {
      int? localId;
      if (sent != null) {
        final snippet = input.body.replaceAll(RegExp(r'\s+'), ' ').trim();
        localId = await txn.insert('messages', {
          'account_id': account.id,
          'folder_id': sent.id,
          'server_folder_id': sent.id,
          'server_uid': 0,
          'message_id': messageId,
          'thread_id': input.inReplyTo.isNotEmpty ? input.inReplyTo : messageId,
          'subject': input.subject,
          'from_name': account.displayName,
          'from_email': account.email,
          'to_json': Address.listToJson(to),
          'cc_json': Address.listToJson(Address.parseList(input.cc)),
          'date': now,
          'snippet': snippet.length > 200 ? snippet.substring(0, 200) : snippet,
          'body_text': input.body,
          'has_body': 1,
          'seen': 1,
          'in_reply_to': input.inReplyTo,
          'references_json': jsonEncode(input.references),
        });
      }
      await db.enqueue(txn, accountId: account.id, messageId: localId, op: 'send', payload: {
        'to': input.to,
        'cc': input.cc,
        'bcc': input.bcc,
        'subject': input.subject,
        'text': input.body,
        'message_id': messageId,
        'in_reply_to': input.inReplyTo,
        'references': input.references,
        'date': now,
      });
      // Recipients only, never message text or secrets.
      await db.audit(txn, 'mail.send', sessionId: account.sessionId, accountId: account.id, target: input.subject, detail: all.map((a) => a.email).join(', '));
    });
    if (input.draftId != null) await deleteDraft(input.draftId!, reloadAfter: false);
    await reload();
    _kick();
  }

  // ----------------------------------------------------------------- folders & outbox

  Future<void> setFolderOffline(int folderId, bool offline) async {
    await db.setFolderOffline(folderId, offline);
    await reload();
    if (offline) unawaited(refresh(quiet: true));
  }

  Future<List<OutboxItem>> outboxItems() => db.outbox();

  Future<void> retry(int id) async {
    await db.retryOutbox(id);
    await reload();
    _kick();
  }

  Future<void> discard(int id) async {
    await db.discardOutbox(id);
    await reload();
    unawaited(refresh(quiet: true)); // bring back the server's version
  }
}
