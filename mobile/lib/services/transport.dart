import 'dart:async';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:enough_mail/enough_mail.dart' as em;

import '../data/models.dart';
import '../util/html_text.dart';

/// What the sync engine needs from a mail server. The real implementation is
/// [EnoughMailConnector]; tests use an in-memory fake.

class RemoteFolder {
  const RemoteFolder({required this.path, required this.name, required this.flags, required this.delimiter, this.selectable = true});
  final String path;
  final String name;
  final List<String> flags;
  final String delimiter;
  final bool selectable;
}

class FolderStatus {
  const FolderStatus({required this.uidValidity, required this.exists, this.uidNext});
  final int uidValidity;
  final int exists;
  final int? uidNext;
}

class RemoteFlags {
  const RemoteFlags({required this.seen, required this.flagged, required this.answered});
  final bool seen;
  final bool flagged;
  final bool answered;
}

class RemoteHeader {
  const RemoteHeader({
    required this.uid,
    required this.messageId,
    required this.subject,
    required this.from,
    required this.to,
    required this.cc,
    required this.date,
    required this.flags,
    required this.size,
    this.inReplyTo = '',
  });
  final int uid;
  final String messageId;
  final String subject;
  final Address from;
  final List<Address> to;
  final List<Address> cc;
  final DateTime? date;
  final RemoteFlags flags;
  final int size;
  final String inReplyTo;
}

class RemoteAttachment {
  const RemoteAttachment(this.filename, this.mime, this.bytes);
  final String filename;
  final String mime;
  final Uint8List bytes;
}

class RemoteBody {
  const RemoteBody({required this.text, required this.html, required this.attachments});
  final String text;
  final String html;
  final List<RemoteAttachment> attachments;
}

/// A message the phone writes: sent mail and drafts.
class OutgoingMail {
  const OutgoingMail({
    required this.from,
    required this.to,
    required this.cc,
    required this.bcc,
    required this.subject,
    required this.text,
    required this.messageId,
    this.inReplyTo = '',
    this.references = const [],
    this.date,
  });
  final Address from;
  final List<Address> to;
  final List<Address> cc;
  final List<Address> bcc;
  final String subject;
  final String text;
  final String messageId;
  final String inReplyTo;
  final List<String> references;
  final DateTime? date;

  List<Address> get recipients => [...to, ...cc, ...bcc];
}

abstract class MailServer {
  Future<List<RemoteFolder>> listFolders();
  Future<FolderStatus> select(String path);
  Future<List<RemoteHeader>> fetchNewest(int count);
  Future<List<RemoteHeader>> fetchSince(int uid);
  Future<Map<int, RemoteFlags>> fetchFlags(int fromUid, int toUid);
  Future<RemoteBody?> fetchBody(int uid);
  Future<void> setFlags(int uid, {bool? seen, bool? flagged});

  /// Moves the message; returns its UID in [targetPath] when the server says (COPYUID).
  Future<int?> move(int uid, String targetPath);
  Future<void> deleteForever(int uid);

  /// Appends to [path]; returns the new UID when the server says (APPENDUID).
  Future<int?> append(String path, OutgoingMail mail, List<String> flags);
  Future<int?> findByMessageId(String messageId);
  Future<void> close();
}

abstract class MailConnector {
  Future<MailServer> open(Account account, String password);
  Future<void> send(Account account, String password, OutgoingMail mail);
}

/// True for failures that mean "try again later", not "the server said no".
bool isOfflineError(Object error) =>
    error is SocketException || error is TimeoutException || error is HandshakeException || error is HttpException ||
    (error is em.ImapException && error.message?.toLowerCase().contains('connection') == true);

// ------------------------------------------------------------------------- enough_mail

class EnoughMailConnector implements MailConnector {
  const EnoughMailConnector();

  @override
  Future<MailServer> open(Account account, String password) async {
    final client = em.ImapClient(defaultResponseTimeout: const Duration(seconds: 60));
    await client.connectToServer(account.imapHost, account.imapPort, isSecure: account.imapSsl, timeout: const Duration(seconds: 20));
    try {
      await client.login(account.username.isNotEmpty ? account.username : account.email, password);
    } catch (_) {
      await client.disconnect();
      rethrow;
    }
    return _EnoughMailServer(client);
  }

  @override
  Future<void> send(Account account, String password, OutgoingMail mail) async {
    final client = em.SmtpClient('poso.app');
    await client.connectToServer(account.smtpHost, account.smtpPort, isSecure: account.smtpMode == 'ssl', timeout: const Duration(seconds: 20));
    try {
      await client.ehlo();
      if (account.smtpMode == 'starttls') {
        await client.startTls();
      }
      await client.authenticate(account.username.isNotEmpty ? account.username : account.email, password, em.AuthMechanism.login);
      await client.sendMessage(buildMime(mail), from: em.MailAddress(mail.from.name, mail.from.email),
          recipients: mail.recipients.map((a) => em.MailAddress(a.name, a.email)).toList());
    } finally {
      try {
        await client.quit();
      } catch (_) {}
    }
  }
}

em.MimeMessage buildMime(OutgoingMail mail) {
  final builder = em.MessageBuilder()
    ..from = [em.MailAddress(mail.from.name, mail.from.email)]
    ..to = mail.to.map((a) => em.MailAddress(a.name, a.email)).toList()
    ..cc = mail.cc.isEmpty ? null : mail.cc.map((a) => em.MailAddress(a.name, a.email)).toList()
    ..bcc = mail.bcc.isEmpty ? null : mail.bcc.map((a) => em.MailAddress(a.name, a.email)).toList()
    ..subject = mail.subject
    ..text = mail.text;
  builder.setHeader('Message-ID', mail.messageId);
  if (mail.inReplyTo.isNotEmpty) builder.setHeader('In-Reply-To', mail.inReplyTo);
  if (mail.references.isNotEmpty) builder.setHeader('References', mail.references.join(' '));
  if (mail.date != null) builder.date = mail.date;
  return builder.buildMimeMessage();
}

class _EnoughMailServer implements MailServer {
  _EnoughMailServer(this.client);

  final em.ImapClient client;
  int _exists = 0;
  static const _headerFields = '(UID FLAGS RFC822.SIZE ENVELOPE)';

  @override
  Future<List<RemoteFolder>> listFolders() async {
    final boxes = await client.listMailboxes(recursive: true);
    return boxes
        .map((b) => RemoteFolder(
              path: b.path,
              name: b.name,
              flags: b.flags.map((f) => f.name).toList(),
              delimiter: b.pathSeparator,
              selectable: !b.isNotSelectable && !b.flags.contains(em.MailboxFlag.nonExistent),
            ))
        .toList();
  }

  @override
  Future<FolderStatus> select(String path) async {
    final box = await client.selectMailboxByPath(path);
    _exists = box.messagesExists;
    return FolderStatus(uidValidity: box.uidValidity ?? 0, exists: box.messagesExists, uidNext: box.uidNext);
  }

  @override
  Future<List<RemoteHeader>> fetchNewest(int count) async {
    final exists = _exists;
    if (exists == 0) return [];
    final result = await client.fetchMessages(em.MessageSequence.fromRange(max(1, exists - count + 1), exists), _headerFields);
    return result.messages.map(_header).whereType<RemoteHeader>().toList();
  }

  @override
  Future<List<RemoteHeader>> fetchSince(int uid) async {
    final result = await client.uidFetchMessages(em.MessageSequence.fromRangeToLast(uid, isUidSequence: true), _headerFields);
    // "n:*" always returns the last message, even when its UID is below n.
    return result.messages.map(_header).whereType<RemoteHeader>().where((h) => h.uid >= uid).toList();
  }

  @override
  Future<Map<int, RemoteFlags>> fetchFlags(int fromUid, int toUid) async {
    final result = await client.uidFetchMessages(em.MessageSequence.fromRange(fromUid, toUid, isUidSequence: true), '(UID FLAGS)');
    return {
      for (final m in result.messages)
        if (m.uid != null) m.uid!: RemoteFlags(seen: m.isSeen, flagged: m.isFlagged, answered: m.isAnswered),
    };
  }

  RemoteHeader? _header(em.MimeMessage m) {
    final uid = m.uid;
    if (uid == null) return null;
    final env = m.envelope;
    final from = env?.from?.isNotEmpty == true ? env!.from!.first : null;
    return RemoteHeader(
      uid: uid,
      messageId: env?.messageId ?? '',
      subject: env?.subject ?? '',
      from: Address(from?.personalName ?? '', from?.email ?? ''),
      to: (env?.to ?? []).map((a) => Address(a.personalName ?? '', a.email)).toList(),
      cc: (env?.cc ?? []).map((a) => Address(a.personalName ?? '', a.email)).toList(),
      date: env?.date,
      flags: RemoteFlags(seen: m.isSeen, flagged: m.isFlagged, answered: m.isAnswered),
      size: m.size ?? 0,
      inReplyTo: env?.inReplyTo ?? '',
    );
  }

  @override
  Future<RemoteBody?> fetchBody(int uid) async {
    final result = await client.uidFetchMessage(uid, 'BODY.PEEK[]');
    if (result.messages.isEmpty) return null;
    final mime = result.messages.first;
    final html = mime.decodeTextHtmlPart() ?? '';
    final text = mime.decodeTextPlainPart() ?? (html.isNotEmpty ? htmlToText(html) : '');
    final attachments = <RemoteAttachment>[];
    for (final info in mime.findContentInfo()) {
      final part = mime.getPart(info.fetchId);
      final bytes = part?.decodeContentBinary();
      if (bytes == null) continue;
      attachments.add(RemoteAttachment(info.fileName ?? 'attachment', info.mediaType?.text ?? 'application/octet-stream', bytes));
    }
    return RemoteBody(text: text, html: html, attachments: attachments);
  }

  em.MessageSequence _uid(int uid) => em.MessageSequence.fromId(uid, isUid: true);

  @override
  Future<void> setFlags(int uid, {bool? seen, bool? flagged}) async {
    Future<void> apply(String flag, bool on) =>
        client.uidStore(_uid(uid), [flag], action: on ? em.StoreAction.add : em.StoreAction.remove, silent: true);
    if (seen != null) await apply(r'\Seen', seen);
    if (flagged != null) await apply(r'\Flagged', flagged);
  }

  @override
  Future<int?> move(int uid, String targetPath) async {
    if (client.serverInfo.supportsMove) {
      final result = await client.uidMove(_uid(uid), targetMailboxPath: targetPath);
      return _firstUid(result.responseCodeCopyUid?.targetSequence);
    }
    final result = await client.uidCopy(_uid(uid), targetMailboxPath: targetPath);
    await deleteForever(uid);
    return _firstUid(result.responseCodeCopyUid?.targetSequence);
  }

  @override
  Future<void> deleteForever(int uid) async {
    await client.uidStore(_uid(uid), [r'\Deleted'], action: em.StoreAction.add, silent: true);
    if (client.serverInfo.supportsUidPlus) {
      await client.uidExpunge(_uid(uid));
    } else {
      await client.expunge();
    }
  }

  @override
  Future<int?> append(String path, OutgoingMail mail, List<String> flags) async {
    final result = await client.appendMessage(buildMime(mail), targetMailboxPath: path, flags: flags);
    return _firstUid(result.responseCodeAppendUid?.targetSequence);
  }

  @override
  Future<int?> findByMessageId(String messageId) async {
    if (messageId.isEmpty) return null;
    final quoted = messageId.replaceAll('"', '');
    final result = await client.uidSearchMessages(searchCriteria: 'HEADER Message-ID "$quoted"');
    final ids = result.matchingSequence?.toList() ?? const <int>[];
    return ids.isEmpty ? null : ids.last;
  }

  int? _firstUid(em.MessageSequence? sequence) {
    final ids = sequence?.toList() ?? const <int>[];
    return ids.isEmpty ? null : ids.first;
  }

  @override
  Future<void> close() async {
    try {
      await client.logout();
    } catch (_) {}
    try {
      await client.disconnect();
    } catch (_) {}
  }
}
