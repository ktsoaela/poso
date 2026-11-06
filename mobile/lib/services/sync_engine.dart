import 'dart:async';
import 'dart:io';
import 'dart:math';

import 'package:path/path.dart' as p;

import '../data/db.dart';
import '../data/models.dart';
import 'presets.dart';
import 'secret_store.dart';
import 'transport.dart';

class FlushResult {
  int pushed = 0;
  int failed = 0;
  bool offline = false;
}

class SyncException implements Exception {
  SyncException(this.message);
  final String message;
  @override
  String toString() => message;
}

/// Moves data between the local mailbox and IMAP/SMTP. The UI never waits on this to show mail.
///
/// * Headers sync first (newest [firstSync] per folder on first run, then only new UIDs).
/// * Bodies and attachments download when a message is opened, or ahead of time for folders
///   marked "available offline".
/// * Queued changes are pushed in order. A message with pending changes keeps its local flags
///   and folder until they are pushed, even if the server sends an older copy meanwhile.
class SyncEngine {
  SyncEngine(this.db, this.secrets, this.connector, this.filesDir);

  final MailDb db;
  final SecretStore secrets;
  final MailConnector connector;
  final String filesDir;

  static const firstSync = {'inbox': 300};
  static const firstSyncDefault = 100;
  static const offlineBodiesPerRun = 25;

  Future<MailServer> _open(Account account) async {
    final password = await secrets.password(account.id);
    if (password == null || password.isEmpty) throw SyncException('No password saved for ${account.email}. Remove and add the account again.');
    return connector.open(account, password);
  }

  // ----------------------------------------------------------------- headers

  Future<void> syncAccount(Account account) async {
    MailServer? server;
    try {
      server = await _open(account);
      final remote = await server.listFolders();
      for (final folder in remote.where((f) => f.selectable)) {
        final role = detectRole(folder.flags, folder.path, folder.delimiter);
        // Gmail's All Mail / Starred / Important repeat mail that is already in other folders.
        final sync = role != 'all' && role != 'virtual';
        final id = await db.upsertFolder(account.id, folder.path, _folderName(folder), role == 'virtual' ? 'custom' : role, sync: sync);
        if (!sync) continue;
        await _syncFolder(server, account, id, folder.path, role);
      }
      await db.setAccountSync(account.id);
    } catch (e) {
      await db.setAccountSync(account.id, error: _describe(e));
      rethrow;
    } finally {
      await server?.close();
    }
  }

  String _folderName(RemoteFolder folder) {
    if (folder.path.toUpperCase() == 'INBOX') return 'Inbox';
    final leaf = folder.delimiter.isEmpty ? folder.path : folder.path.split(folder.delimiter).last;
    return leaf.isEmpty ? folder.name : leaf;
  }

  Future<void> _syncFolder(MailServer server, Account account, int folderId, String path, String role) async {
    final state = await db.folderState(folderId);
    final status = await server.select(path);
    var highest = state['highest_uid'] as int;
    final known = state['uidvalidity'] as int;
    if (known != 0 && known != status.uidValidity) {
      await db.resetFolder(folderId);
      highest = 0;
    }

    final headers = highest == 0 ? await server.fetchNewest(firstSync[role] ?? firstSyncDefault) : await server.fetchSince(highest + 1);
    for (final h in headers) {
      await _storeHeader(account, folderId, h);
      highest = max(highest, h.uid);
    }

    // Flags and deletions for what we already have.
    final local = await db.serverUids(folderId);
    if (local.isNotEmpty) {
      final lo = local.reduce(min);
      final hi = max(local.reduce(max), highest);
      final flags = await server.fetchFlags(lo, hi);
      for (final entry in flags.entries) {
        final row = await db.byServer(folderId, entry.key);
        if (row == null || (row['pending'] as int) > 0) continue; // local change wins until pushed
        final f = entry.value;
        if ((row['seen'] == 1) != f.seen || (row['flagged'] == 1) != f.flagged || (row['answered'] == 1) != f.answered) {
          await db.updateMessage(row['id'] as int, {'seen': f.seen ? 1 : 0, 'flagged': f.flagged ? 1 : 0, 'answered': f.answered ? 1 : 0});
        }
      }
      await db.removeVanished(folderId, local.toSet().difference(flags.keys.toSet()));
    }
    await db.setFolderState(folderId, uidvalidity: status.uidValidity, highestUid: highest);

    final offline = (state['offline'] as int) == 1;
    if (offline) {
      for (final row in await db.missingBodies(folderId, offlineBodiesPerRun)) {
        await _downloadWith(server, row['id'] as int, selected: path);
      }
    }
  }

  Future<void> _storeHeader(Account account, int folderId, RemoteHeader h) async {
    final existing = await db.byServer(folderId, h.uid);
    if (existing != null) return;
    final waiting = await db.awaitingUid(folderId, h.messageId);
    if (waiting != null) {
      // Our own sent copy or a moved message: now we know its UID.
      await db.updateMessage(waiting, {'server_uid': h.uid});
      return;
    }
    await db.insertMessage({
      'account_id': account.id,
      'folder_id': folderId,
      'server_folder_id': folderId,
      'server_uid': h.uid,
      'message_id': h.messageId,
      'thread_id': h.inReplyTo.isNotEmpty ? h.inReplyTo : h.messageId,
      'subject': h.subject,
      'from_name': h.from.name,
      'from_email': h.from.email,
      'to_json': Address.listToJson(h.to),
      'cc_json': Address.listToJson(h.cc),
      'date': h.date?.millisecondsSinceEpoch,
      'seen': h.flags.seen ? 1 : 0,
      'flagged': h.flags.flagged ? 1 : 0,
      'answered': h.flags.answered ? 1 : 0,
      'size': h.size,
      'in_reply_to': h.inReplyTo,
    });
  }

  // ----------------------------------------------------------------- bodies

  Future<void> downloadBody(int messageId) async {
    final row = await db.message(messageId);
    if (row == null || row.hasBody) return;
    final account = await db.account(row.accountId);
    if (account == null) return;
    final server = await _open(account);
    try {
      await _downloadWith(server, messageId);
    } finally {
      await server.close();
    }
  }

  Future<void> _downloadWith(MailServer server, int messageId, {String? selected}) async {
    final row = await db.message(messageId);
    if (row == null) return;
    final located = await _locate(server, row, selected: selected);
    if (located == null) return;
    final body = await server.fetchBody(located);
    if (body == null) return;
    final dir = Directory(p.join(filesDir, 'attachments', '$messageId'));
    final saved = <Map<String, Object?>>[];
    if (body.attachments.isNotEmpty) await dir.create(recursive: true);
    for (final (index, item) in body.attachments.indexed) {
      final safe = item.filename.replaceAll(RegExp(r'[\\/:*?"<>|]'), '_');
      final file = File(p.join(dir.path, '${index}_$safe'));
      await file.writeAsBytes(item.bytes, flush: true);
      saved.add({'filename': item.filename, 'mime': item.mime, 'size': item.bytes.length, 'path': file.path});
    }
    await db.saveBody(messageId, text: body.text, html: body.html, attachments: saved);
  }

  /// Selects the folder the server has the message in and returns its UID there.
  Future<int?> _locate(MailServer server, Message row, {String? selected}) async {
    final folder = await db.folder(row.serverFolderId);
    if (folder == null) return null;
    if (selected != folder.path) await server.select(folder.path);
    if (row.serverUid > 0) return row.serverUid;
    final uid = await server.findByMessageId(row.messageId);
    if (uid != null) await db.updateMessage(row.id, {'server_uid': uid});
    return uid;
  }

  // ----------------------------------------------------------------- outbox

  Future<FlushResult> flushOutbox() async {
    final result = FlushResult();
    final servers = <int, MailServer>{};
    try {
      for (final item in await db.outbox(status: 'pending')) {
        final account = await db.account(item.accountId);
        if (account == null) {
          await db.completeOutbox(item);
          continue;
        }
        try {
          await _push(item, account, () async => servers[account.id] ??= await _open(account));
          await db.completeOutbox(item);
          result.pushed++;
        } catch (e) {
          if (isOfflineError(e)) {
            await db.noteAttempt(item, _describe(e));
            result.offline = true;
            return result;
          }
          await db.noteAttempt(item, _describe(e));
          if (item.attempts + 1 >= 3) {
            await db.failOutbox(item, _describe(e));
            result.failed++;
          }
        }
      }
    } finally {
      for (final server in servers.values) {
        await server.close();
      }
    }
    return result;
  }

  Future<void> _push(OutboxItem item, Account account, Future<MailServer> Function() imap) async {
    final payload = item.payload;
    switch (item.op) {
      case 'flags':
        final row = item.messageId == null ? null : await db.message(item.messageId!);
        if (row == null) return;
        final server = await imap();
        final uid = await _locate(server, row);
        if (uid == null) throw SyncException('The message is no longer on the server.');
        await server.setFlags(uid, seen: payload['seen'] as bool?, flagged: payload['flagged'] as bool?);
      case 'move':
        final row = item.messageId == null ? null : await db.message(item.messageId!);
        if (row == null) return;
        final target = await db.folder(payload['target_folder_id'] as int);
        if (target == null || target.id == row.serverFolderId) return;
        final server = await imap();
        final uid = await _locate(server, row);
        if (uid == null) throw SyncException('The message is no longer on the server.');
        final moved = await server.move(uid, target.path);
        await db.updateMessage(row.id, {'server_folder_id': target.id, 'server_uid': moved ?? 0});
      case 'delete':
        final folder = await db.folder(payload['folder_id'] as int);
        if (folder == null) return;
        final server = await imap();
        await server.select(folder.path);
        final known = payload['uid'] as int? ?? 0;
        final uid = known > 0 ? known : await server.findByMessageId(payload['message_id'] as String? ?? '');
        if (uid != null) await server.deleteForever(uid);
      case 'draft':
        final draft = await db.draft(payload['draft_id'] as int);
        if (draft == null) return; // deleted since; draft_delete handles the server copy
        final folder = await db.folderByRole(account.id, 'drafts');
        if (folder == null) return; // no Drafts folder on this server: keep it on the phone only
        final server = await imap();
        await server.select(folder.path);
        final old = draft.serverUid > 0 ? draft.serverUid : await server.findByMessageId(draft.messageId);
        if (old != null) await server.deleteForever(old);
        final uid = await server.append(folder.path, _draftMail(account, draft), [r'\Draft', r'\Seen']);
        await db.db.update('drafts', {'server_uid': uid ?? 0}, where: 'id = ?', whereArgs: [draft.id]);
      case 'draft_delete':
        final folder = await db.folderByRole(account.id, 'drafts');
        if (folder == null) return;
        final server = await imap();
        await server.select(folder.path);
        final known = payload['server_uid'] as int? ?? 0;
        final uid = known > 0 ? known : await server.findByMessageId(payload['message_id'] as String? ?? '');
        if (uid != null) await server.deleteForever(uid);
      case 'send':
        final mail = _sendMail(account, payload);
        final password = await secrets.password(account.id);
        if (password == null) throw SyncException('No password saved for ${account.email}.');
        await connector.send(account, password, mail);
        // Gmail files sent mail itself; elsewhere keep a copy in Sent. A failed copy must not resend.
        if (!account.isGmail) {
          try {
            final sent = await db.folderByRole(account.id, 'sent');
            if (sent != null) {
              final server = await imap();
              final uid = await server.append(sent.path, mail, [r'\Seen']);
              if (uid != null && item.messageId != null) await db.updateMessage(item.messageId!, {'server_uid': uid});
            }
          } catch (_) {}
        }
      default:
        return;
    }
  }

  OutgoingMail _draftMail(Account account, Draft d) => OutgoingMail(
        from: Address(account.displayName, account.email),
        to: Address.parseList(d.to),
        cc: Address.parseList(d.cc),
        bcc: Address.parseList(d.bcc),
        subject: d.subject,
        text: d.body,
        messageId: d.messageId,
        inReplyTo: d.inReplyTo,
        references: d.references,
        date: d.updatedAt,
      );

  OutgoingMail _sendMail(Account account, Map<String, dynamic> p) => OutgoingMail(
        from: Address(account.displayName, account.email),
        to: Address.parseList(p['to'] as String? ?? ''),
        cc: Address.parseList(p['cc'] as String? ?? ''),
        bcc: Address.parseList(p['bcc'] as String? ?? ''),
        subject: p['subject'] as String? ?? '',
        text: p['text'] as String? ?? '',
        messageId: p['message_id'] as String,
        inReplyTo: p['in_reply_to'] as String? ?? '',
        references: ((p['references'] as List?) ?? const []).map((e) => '$e').toList(),
        date: DateTime.fromMillisecondsSinceEpoch(p['date'] as int? ?? DateTime.now().millisecondsSinceEpoch),
      );

  static String _describe(Object e) {
    final text = e is SyncException ? e.message : e.toString();
    return text.length > 300 ? text.substring(0, 300) : text;
  }
}
