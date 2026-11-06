import 'dart:io';
import 'dart:typed_data';

import 'package:poso/data/models.dart';
import 'package:poso/services/transport.dart';

class FakeMessage {
  FakeMessage({
    required this.uid,
    required this.messageId,
    required this.subject,
    this.from = const Address('Dana', 'dana@example.com'),
    this.to = const [Address('', 'me@example.com')],
    this.text = 'Hello',
    this.seen = false,
    this.flagged = false,
    this.attachments = const [],
  });
  int uid;
  final String messageId;
  final String subject;
  final Address from;
  final List<Address> to;
  final String text;
  bool seen;
  bool flagged;
  final List<RemoteAttachment> attachments;
}

class FakeFolder {
  FakeFolder(this.path, this.flags, {this.uidValidity = 1});
  final String path;
  final List<String> flags;
  int uidValidity;
  int nextUid = 1;
  final Map<int, FakeMessage> messages = {};

  FakeMessage add(String subject, {String? messageId, bool seen = false, String text = 'Hello', List<RemoteAttachment> attachments = const []}) {
    final m = FakeMessage(uid: nextUid++, messageId: messageId ?? '<${path.hashCode}-$nextUid@fake>', subject: subject, seen: seen, text: text, attachments: attachments);
    messages[m.uid] = m;
    return m;
  }
}

/// An in-memory IMAP + SMTP account. Set [offline] to make every call fail like a dead network.
class FakeAccountServer implements MailConnector {
  FakeAccountServer({this.supportsUidPlus = true}) {
    for (final f in [
      FakeFolder('INBOX', const []),
      FakeFolder('Sent', const ['sent']),
      FakeFolder('Drafts', const ['drafts']),
      FakeFolder('Archive', const ['archive']),
      FakeFolder('Trash', const ['trash']),
      FakeFolder('Junk', const ['junk']),
    ]) {
      folders[f.path] = f;
    }
  }

  /// When false, MOVE and APPEND do not report the new UID (no COPYUID/APPENDUID).
  final bool supportsUidPlus;
  final Map<String, FakeFolder> folders = {};
  final List<OutgoingMail> sent = [];
  bool offline = false;
  String password = 'secret';
  int opens = 0;

  FakeFolder get inbox => folders['INBOX']!;

  void _check() {
    if (offline) throw const SocketException('Network is unreachable');
  }

  @override
  Future<MailServer> open(Account account, String password) async {
    _check();
    if (password != this.password) throw Exception('AUTHENTICATIONFAILED Invalid credentials');
    opens++;
    return _FakeSession(this);
  }

  @override
  Future<void> send(Account account, String password, OutgoingMail mail) async {
    _check();
    sent.add(mail);
  }
}

class _FakeSession implements MailServer {
  _FakeSession(this.server);
  final FakeAccountServer server;
  FakeFolder? selected;

  FakeFolder get _sel => selected ?? (throw StateError('no folder selected'));

  RemoteHeader _header(FakeMessage m) => RemoteHeader(
        uid: m.uid,
        messageId: m.messageId,
        subject: m.subject,
        from: m.from,
        to: m.to,
        cc: const [],
        date: DateTime(2026, 11, 1).add(Duration(minutes: m.uid)),
        flags: RemoteFlags(seen: m.seen, flagged: m.flagged, answered: false),
        size: m.text.length,
      );

  @override
  Future<List<RemoteFolder>> listFolders() async {
    server._check();
    return server.folders.values.map((f) => RemoteFolder(path: f.path, name: f.path, flags: f.flags, delimiter: '/')).toList();
  }

  @override
  Future<FolderStatus> select(String path) async {
    server._check();
    selected = server.folders[path]!;
    return FolderStatus(uidValidity: _sel.uidValidity, exists: _sel.messages.length, uidNext: _sel.nextUid);
  }

  @override
  Future<List<RemoteHeader>> fetchNewest(int count) async {
    server._check();
    final all = _sel.messages.values.toList()..sort((a, b) => a.uid.compareTo(b.uid));
    return all.skip(all.length > count ? all.length - count : 0).map(_header).toList();
  }

  @override
  Future<List<RemoteHeader>> fetchSince(int uid) async {
    server._check();
    return _sel.messages.values.where((m) => m.uid >= uid).map(_header).toList();
  }

  @override
  Future<Map<int, RemoteFlags>> fetchFlags(int fromUid, int toUid) async {
    server._check();
    return {
      for (final m in _sel.messages.values)
        if (m.uid >= fromUid && m.uid <= toUid) m.uid: RemoteFlags(seen: m.seen, flagged: m.flagged, answered: false),
    };
  }

  @override
  Future<RemoteBody?> fetchBody(int uid) async {
    server._check();
    final m = _sel.messages[uid];
    return m == null ? null : RemoteBody(text: m.text, html: '', attachments: m.attachments);
  }

  @override
  Future<void> setFlags(int uid, {bool? seen, bool? flagged}) async {
    server._check();
    final m = _sel.messages[uid] ?? (throw Exception('NO such message'));
    if (seen != null) m.seen = seen;
    if (flagged != null) m.flagged = flagged;
  }

  @override
  Future<int?> move(int uid, String targetPath) async {
    server._check();
    final m = _sel.messages.remove(uid) ?? (throw Exception('NO such message'));
    final target = server.folders[targetPath]!;
    m.uid = target.nextUid++;
    target.messages[m.uid] = m;
    return server.supportsUidPlus ? m.uid : null;
  }

  @override
  Future<void> deleteForever(int uid) async {
    server._check();
    _sel.messages.remove(uid);
  }

  @override
  Future<int?> append(String path, OutgoingMail mail, List<String> flags) async {
    server._check();
    final target = server.folders[path]!;
    final m = FakeMessage(
      uid: target.nextUid++,
      messageId: mail.messageId,
      subject: mail.subject,
      from: mail.from,
      to: mail.to,
      text: mail.text,
      seen: flags.contains(r'\Seen'),
    );
    target.messages[m.uid] = m;
    return server.supportsUidPlus ? m.uid : null;
  }

  @override
  Future<int?> findByMessageId(String messageId) async {
    server._check();
    for (final m in _sel.messages.values) {
      if (m.messageId == messageId) return m.uid;
    }
    return null;
  }

  @override
  Future<void> close() async {}
}

final emptyBytes = Uint8List(0);
