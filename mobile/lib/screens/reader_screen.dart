import 'package:flutter/material.dart';
import 'package:open_filex/open_filex.dart';
import 'package:provider/provider.dart';

import '../data/models.dart';
import '../services/connectivity_service.dart';
import '../services/mailbox.dart';
import '../widgets/format.dart';
import '../widgets/message_tile.dart';
import 'compose_screen.dart';

class ReaderScreen extends StatefulWidget {
  const ReaderScreen({super.key, required this.messageId});
  final int messageId;

  @override
  State<ReaderScreen> createState() => _ReaderScreenState();
}

class _ReaderScreenState extends State<ReaderScreen> {
  Message? message;
  List<Attachment> attachments = const [];
  bool loading = true;
  String? error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final mail = context.read<Mailbox>();
    try {
      final opened = await mail.open(widget.messageId);
      final files = await mail.attachments(widget.messageId);
      if (!mounted) return;
      setState(() {
        message = opened;
        attachments = files;
        loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      final fallback = await mail.db.message(widget.messageId);
      setState(() {
        message = fallback;
        error = '$e';
        loading = false;
      });
    }
  }

  Future<void> _refreshRow() async {
    final row = await context.read<Mailbox>().db.message(widget.messageId);
    if (!mounted) return;
    if (row == null || row.folderId != message?.folderId) {
      Navigator.of(context).pop();
      return;
    }
    setState(() => message = row);
  }

  Future<void> _moveTo(String role, String done) async {
    final mail = context.read<Mailbox>();
    final messenger = ScaffoldMessenger.of(context);
    final moved = await mail.moveToRole([widget.messageId], role);
    messenger.showSnackBar(SnackBar(content: Text(moved > 0 ? done : 'This account has no ${roleTitles[role]} folder yet.')));
    if (moved > 0 && mounted) Navigator.of(context).pop();
  }

  Future<void> _pickFolder() async {
    final mail = context.read<Mailbox>();
    final m = message!;
    final folders = mail.folders.where((f) => f.accountId == m.accountId && f.id != m.folderId && f.role != 'drafts').toList();
    final target = await showModalBottomSheet<int>(
      context: context,
      showDragHandle: true,
      builder: (context) => ListView(shrinkWrap: true, children: [
        for (final f in folders) ListTile(leading: const Icon(Icons.folder_outlined), title: Text(f.name), onTap: () => Navigator.of(context).pop(f.id)),
      ]),
    );
    if (target == null) return;
    await mail.moveToFolder(m.id, target);
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final mail = context.read<Mailbox>();
    final online = context.watch<ConnectivityService>().online;
    final m = message;
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        actions: m == null
            ? null
            : [
                if (m.folderRole != 'archive')
                  IconButton(tooltip: 'Archive', icon: const Icon(Icons.archive_outlined), onPressed: () => _moveTo('archive', 'Archived')),
                IconButton(
                  tooltip: 'Delete',
                  icon: const Icon(Icons.delete_outline),
                  onPressed: () async {
                    final messenger = ScaffoldMessenger.of(context);
                    final forever = m.folderRole == 'trash' || m.folderRole == 'spam';
                    await mail.delete([m.id]);
                    messenger.showSnackBar(SnackBar(content: Text(forever ? 'Deleted forever' : 'Moved to Trash')));
                    if (context.mounted) Navigator.of(context).pop();
                  },
                ),
                IconButton(
                  tooltip: m.flagged ? 'Unflag' : 'Flag',
                  icon: Icon(m.flagged ? Icons.flag : Icons.flag_outlined, color: m.flagged ? const Color(0xFFF59E0B) : null),
                  onPressed: () async {
                    await mail.setFlagged([m.id], !m.flagged);
                    await _refreshRow();
                  },
                ),
                PopupMenuButton<String>(
                  onSelected: (value) async {
                    switch (value) {
                      case 'unread':
                        await mail.setSeen([m.id], false);
                        if (context.mounted) Navigator.of(context).pop();
                      case 'move':
                        await _pickFolder();
                      case 'inbox':
                        await _moveTo('inbox', 'Moved to Inbox');
                      case 'spam':
                        await _moveTo('spam', 'Moved to Spam');
                    }
                  },
                  itemBuilder: (_) => [
                    const PopupMenuItem(value: 'unread', child: Text('Mark unread')),
                    const PopupMenuItem(value: 'move', child: Text('Move to…')),
                    if (m.folderRole != 'inbox') const PopupMenuItem(value: 'inbox', child: Text('Move to Inbox')),
                    if (m.folderRole != 'spam') const PopupMenuItem(value: 'spam', child: Text('Report spam')),
                  ],
                ),
              ],
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : m == null
              ? const Center(child: Text('This message is gone.'))
              : ListView(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 100),
                  children: [
                    Text(m.subject.isEmpty ? '(no subject)' : m.subject, style: theme.textTheme.headlineSmall),
                    const SizedBox(height: 16),
                    Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Avatar(name: m.fromName, email: m.fromEmail),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(m.sender, style: theme.textTheme.titleSmall),
                          if (m.fromName.isNotEmpty) Text(m.fromEmail, style: theme.textTheme.bodySmall),
                          Text('to ${[...m.to, ...m.cc].map((a) => a.display).join(', ')}',
                              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline), maxLines: 2, overflow: TextOverflow.ellipsis),
                        ]),
                      ),
                      Text(fullDate(m.date), style: theme.textTheme.labelSmall),
                    ]),
                    if (m.pending > 0)
                      Padding(
                        padding: const EdgeInsets.only(top: 12),
                        child: Row(children: [
                          Icon(Icons.cloud_upload_outlined, size: 16, color: theme.colorScheme.outline),
                          const SizedBox(width: 6),
                          Text('Changes waiting to sync', style: theme.textTheme.bodySmall),
                        ]),
                      ),
                    const Divider(height: 32),
                    if (!m.hasBody)
                      Card.outlined(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Text(error != null
                              ? 'Couldn’t download this message: $error'
                              : online
                                  ? 'This message hasn’t downloaded yet.'
                                  : 'This message hasn’t downloaded to the phone. It will open when you’re back online, or mark the folder “available offline” in Settings.'),
                        ),
                      )
                    else
                      SelectableText(m.bodyText.isEmpty ? '(This message has no text.)' : m.bodyText, style: theme.textTheme.bodyMedium?.copyWith(height: 1.5)),
                    if (attachments.isNotEmpty) ...[
                      const SizedBox(height: 24),
                      Text('${attachments.length} attachment${attachments.length == 1 ? '' : 's'}', style: theme.textTheme.titleSmall),
                      const SizedBox(height: 8),
                      for (final a in attachments)
                        Card.outlined(
                          child: ListTile(
                            leading: const Icon(Icons.attach_file),
                            title: Text(a.filename, overflow: TextOverflow.ellipsis),
                            subtitle: Text('${fileSize(a.size)} · saved on phone'),
                            onTap: () => OpenFilex.open(a.path, type: a.mime),
                          ),
                        ),
                    ],
                  ],
                ),
      bottomNavigationBar: m == null
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                child: Row(children: [
                  Expanded(child: OutlinedButton.icon(onPressed: () => openReply(context, m, all: false), icon: const Icon(Icons.reply), label: const Text('Reply'))),
                  const SizedBox(width: 8),
                  Expanded(child: OutlinedButton.icon(onPressed: () => openReply(context, m, all: true), icon: const Icon(Icons.reply_all), label: const Text('Reply all'))),
                  const SizedBox(width: 8),
                  Expanded(child: OutlinedButton.icon(onPressed: () => openForward(context, m), icon: const Icon(Icons.forward), label: const Text('Forward'))),
                ]),
              ),
            ),
    );
  }
}
