import 'dart:convert';

/// Plain row types for the local mailbox. They mirror engine/session_mail/models.py:
/// an account belongs to one session, a message belongs to an account and a folder.

int _int(Object? v) => v is int ? v : (v is bool ? (v ? 1 : 0) : int.tryParse('$v') ?? 0);
bool _bool(Object? v) => _int(v) != 0;
String _str(Object? v) => v == null ? '' : '$v';

class MailSessionRow {
  MailSessionRow({required this.id, required this.name, required this.color});
  final int id;
  final String name;
  final String color;

  factory MailSessionRow.fromRow(Map<String, Object?> r) =>
      MailSessionRow(id: _int(r['id']), name: _str(r['name']), color: _str(r['color']));
}

class Account {
  Account({
    required this.id,
    required this.sessionId,
    required this.email,
    required this.username,
    required this.displayName,
    required this.provider,
    required this.imapHost,
    required this.imapPort,
    required this.imapSsl,
    required this.smtpHost,
    required this.smtpPort,
    required this.smtpMode,
    required this.color,
    this.lastSyncAt,
    this.lastError = '',
  });

  final int id;
  final int sessionId;
  final String email;
  final String username;
  final String displayName;
  final String provider;
  final String imapHost;
  final int imapPort;
  final bool imapSsl;
  final String smtpHost;
  final int smtpPort;
  final String smtpMode; // ssl | starttls | plain
  final String color;
  final DateTime? lastSyncAt;
  final String lastError;

  String get label => displayName.isNotEmpty ? displayName : email;
  bool get isGmail => provider == 'gmail' || imapHost.toLowerCase().endsWith('gmail.com');

  factory Account.fromRow(Map<String, Object?> r) => Account(
        id: _int(r['id']),
        sessionId: _int(r['session_id']),
        email: _str(r['email']),
        username: _str(r['username']),
        displayName: _str(r['display_name']),
        provider: _str(r['provider']),
        imapHost: _str(r['imap_host']),
        imapPort: _int(r['imap_port']),
        imapSsl: _bool(r['imap_ssl']),
        smtpHost: _str(r['smtp_host']),
        smtpPort: _int(r['smtp_port']),
        smtpMode: _str(r['smtp_mode']),
        color: _str(r['color']),
        lastSyncAt: r['last_sync_at'] == null ? null : DateTime.fromMillisecondsSinceEpoch(_int(r['last_sync_at'])),
        lastError: _str(r['last_error']),
      );
}

class Folder {
  Folder({
    required this.id,
    required this.accountId,
    required this.path,
    required this.name,
    required this.role,
    required this.offline,
    required this.unread,
  });

  final int id;
  final int accountId;
  final String path;
  final String name;
  final String role; // inbox | sent | drafts | trash | spam | archive | all | custom
  final bool offline;
  final int unread;

  factory Folder.fromRow(Map<String, Object?> r) => Folder(
        id: _int(r['id']),
        accountId: _int(r['account_id']),
        path: _str(r['path']),
        name: _str(r['name']),
        role: _str(r['role']),
        offline: _bool(r['offline']),
        unread: _int(r['unread']),
      );
}

class Address {
  const Address(this.name, this.email);
  final String name;
  final String email;

  String get display => name.isNotEmpty ? name : email;
  String get full => name.isNotEmpty ? '$name <$email>' : email;

  Map<String, String> toJson() => {'name': name, 'email': email};

  static List<Address> listFromJson(String raw) {
    try {
      final data = jsonDecode(raw.isEmpty ? '[]' : raw) as List;
      return data.map((e) => Address(_str((e as Map)['name']), _str(e['email']))).toList();
    } catch (_) {
      return const [];
    }
  }

  static String listToJson(List<Address> items) => jsonEncode(items.map((e) => e.toJson()).toList());

  /// Parses `Name <a@b>, c@d` as typed in the compose fields.
  static List<Address> parseList(String text) {
    final out = <Address>[];
    for (final raw in text.split(RegExp(r'[,;]'))) {
      final part = raw.trim();
      if (part.isEmpty) continue;
      final match = RegExp(r'^(.*)<([^>]+)>$').firstMatch(part);
      if (match != null) {
        out.add(Address(match.group(1)!.trim().replaceAll('"', ''), match.group(2)!.trim()));
      } else {
        out.add(Address('', part));
      }
    }
    return out;
  }
}

class Message {
  Message({
    required this.id,
    required this.accountId,
    required this.folderId,
    required this.serverFolderId,
    required this.serverUid,
    required this.messageId,
    required this.threadId,
    required this.subject,
    required this.fromName,
    required this.fromEmail,
    required this.to,
    required this.cc,
    required this.date,
    required this.snippet,
    required this.bodyText,
    required this.bodyHtml,
    required this.hasBody,
    required this.seen,
    required this.flagged,
    required this.answered,
    required this.size,
    required this.inReplyTo,
    required this.references,
    required this.pending,
    this.folderRole = '',
    this.accountEmail = '',
    this.accountColor = '',
  });

  final int id;
  final int accountId;
  final int folderId;
  final int serverFolderId;
  final int serverUid;
  final String messageId;
  final String threadId;
  final String subject;
  final String fromName;
  final String fromEmail;
  final List<Address> to;
  final List<Address> cc;
  final DateTime? date;
  final String snippet;
  final String bodyText;
  final String bodyHtml;
  final bool hasBody;
  final bool seen;
  final bool flagged;
  final bool answered;
  final int size;
  final String inReplyTo;
  final List<String> references;
  final int pending;
  final String folderRole;
  final String accountEmail;
  final String accountColor;

  String get sender => fromName.isNotEmpty ? fromName : fromEmail;

  factory Message.fromRow(Map<String, Object?> r) {
    List<String> refs;
    try {
      refs = (jsonDecode(_str(r['references_json']).isEmpty ? '[]' : _str(r['references_json'])) as List).map((e) => '$e').toList();
    } catch (_) {
      refs = const [];
    }
    return Message(
      id: _int(r['id']),
      accountId: _int(r['account_id']),
      folderId: _int(r['folder_id']),
      serverFolderId: _int(r['server_folder_id']),
      serverUid: _int(r['server_uid']),
      messageId: _str(r['message_id']),
      threadId: _str(r['thread_id']),
      subject: _str(r['subject']),
      fromName: _str(r['from_name']),
      fromEmail: _str(r['from_email']),
      to: Address.listFromJson(_str(r['to_json'])),
      cc: Address.listFromJson(_str(r['cc_json'])),
      date: r['date'] == null ? null : DateTime.fromMillisecondsSinceEpoch(_int(r['date'])),
      snippet: _str(r['snippet']),
      bodyText: _str(r['body_text']),
      bodyHtml: _str(r['body_html']),
      hasBody: _bool(r['has_body']),
      seen: _bool(r['seen']),
      flagged: _bool(r['flagged']),
      answered: _bool(r['answered']),
      size: _int(r['size']),
      inReplyTo: _str(r['in_reply_to']),
      references: refs,
      pending: _int(r['pending']),
      folderRole: _str(r['folder_role']),
      accountEmail: _str(r['account_email']),
      accountColor: _str(r['account_color']),
    );
  }
}

class Attachment {
  Attachment({required this.id, required this.filename, required this.mime, required this.size, required this.path});
  final int id;
  final String filename;
  final String mime;
  final int size;
  final String path;

  factory Attachment.fromRow(Map<String, Object?> r) => Attachment(
        id: _int(r['id']),
        filename: _str(r['filename']),
        mime: _str(r['mime']),
        size: _int(r['size']),
        path: _str(r['path']),
      );
}

class Draft {
  Draft({
    required this.id,
    required this.accountId,
    required this.messageId,
    required this.to,
    required this.cc,
    required this.bcc,
    required this.subject,
    required this.body,
    required this.inReplyTo,
    required this.references,
    required this.updatedAt,
    this.serverUid = 0,
  });

  final int id;
  final int accountId;
  final String messageId;
  final String to;
  final String cc;
  final String bcc;
  final String subject;
  final String body;
  final String inReplyTo;
  final List<String> references;
  final DateTime updatedAt;
  final int serverUid;

  factory Draft.fromRow(Map<String, Object?> r) {
    List<String> refs;
    try {
      refs = (jsonDecode(_str(r['references_json']).isEmpty ? '[]' : _str(r['references_json'])) as List).map((e) => '$e').toList();
    } catch (_) {
      refs = const [];
    }
    return Draft(
      id: _int(r['id']),
      accountId: _int(r['account_id']),
      messageId: _str(r['message_id']),
      to: _str(r['to_text']),
      cc: _str(r['cc_text']),
      bcc: _str(r['bcc_text']),
      subject: _str(r['subject']),
      body: _str(r['body']),
      inReplyTo: _str(r['in_reply_to']),
      references: refs,
      updatedAt: DateTime.fromMillisecondsSinceEpoch(_int(r['updated_at'])),
      serverUid: _int(r['server_uid']),
    );
  }
}

class OutboxItem {
  OutboxItem({
    required this.id,
    required this.clientId,
    required this.accountId,
    required this.messageId,
    required this.op,
    required this.payload,
    required this.status,
    required this.attempts,
    required this.lastError,
    required this.createdAt,
  });

  final int id;
  final String clientId;
  final int accountId;
  final int? messageId;
  final String op; // flags | move | delete | draft | draft_delete | send
  final Map<String, dynamic> payload;
  final String status; // pending | failed
  final int attempts;
  final String lastError;
  final DateTime createdAt;

  factory OutboxItem.fromRow(Map<String, Object?> r) => OutboxItem(
        id: _int(r['id']),
        clientId: _str(r['client_id']),
        accountId: _int(r['account_id']),
        messageId: r['message_id'] == null ? null : _int(r['message_id']),
        op: _str(r['op']),
        payload: Map<String, dynamic>.from(jsonDecode(_str(r['payload_json']).isEmpty ? '{}' : _str(r['payload_json'])) as Map),
        status: _str(r['status']),
        attempts: _int(r['attempts']),
        lastError: _str(r['last_error']),
        createdAt: DateTime.fromMillisecondsSinceEpoch(_int(r['created_at'])),
      );

  String get describe {
    switch (op) {
      case 'flags':
        final parts = <String>[];
        if (payload['seen'] != null) parts.add(payload['seen'] == true ? 'Mark read' : 'Mark unread');
        if (payload['flagged'] != null) parts.add(payload['flagged'] == true ? 'Flag' : 'Unflag');
        return parts.join(', ');
      case 'move':
        return 'Move to ${payload['target_name'] ?? 'folder'}';
      case 'delete':
        return 'Delete forever';
      case 'draft':
        return 'Save draft';
      case 'draft_delete':
        return 'Remove draft';
      case 'send':
        return 'Send “${payload['subject'] ?? ''}”';
      default:
        return op;
    }
  }
}
