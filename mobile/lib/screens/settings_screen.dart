import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../app.dart';
import '../data/models.dart';
import '../services/mailbox.dart';
import '../widgets/format.dart';
import 'account_screen.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key, this.scrollToQueue = false});
  final bool scrollToQueue;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  List<OutboxItem> queue = const [];
  final _queueKey = GlobalKey();

  @override
  void initState() {
    super.initState();
    _loadQueue();
  }

  Future<void> _loadQueue() async {
    final items = await context.read<Mailbox>().outboxItems();
    if (!mounted) return;
    setState(() => queue = items);
    if (widget.scrollToQueue) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final ctx = _queueKey.currentContext;
        if (ctx != null) Scrollable.ensureVisible(ctx, duration: const Duration(milliseconds: 250));
      });
    }
  }

  Future<void> _remove(Account account) async {
    final mail = context.read<Mailbox>();
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Remove ${account.email}?'),
        content: const Text('Its mail, attachments and unsent changes are deleted from this phone. Nothing is deleted on the server.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Remove')),
        ],
      ),
    );
    if (ok == true) {
      await mail.removeAccount(account.id);
      await _loadQueue();
    }
  }

  @override
  Widget build(BuildContext context) {
    final mail = context.watch<Mailbox>();
    final theme = Theme.of(context);
    Widget heading(String text, {Key? key}) =>
        Padding(key: key, padding: const EdgeInsets.fromLTRB(16, 24, 16, 8), child: Text(text, style: theme.textTheme.titleSmall?.copyWith(color: theme.colorScheme.primary)));
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: RefreshIndicator(
        onRefresh: () async {
          await mail.refresh();
          await _loadQueue();
        },
        child: ListView(
          children: [
            heading('Accounts in ${mail.activeSession!.name}'),
            for (final a in mail.accounts)
              ListTile(
                leading: CircleAvatar(backgroundColor: hexColor(a.color), radius: 8),
                title: Text(a.email),
                subtitle: Text(a.lastError.isNotEmpty
                    ? 'Last sync failed: ${a.lastError}'
                    : a.lastSyncAt == null
                        ? 'Not synced yet'
                        : 'Synced ${listDate(a.lastSyncAt)}'),
                trailing: IconButton(tooltip: 'Remove from phone', icon: const Icon(Icons.delete_outline), onPressed: () => _remove(a)),
              ),
            ListTile(
              leading: const Icon(Icons.person_add_alt),
              title: const Text('Add account'),
              onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => AccountScreen(sessionId: mail.sessionId))),
            ),
            heading('Available offline'),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text('Headers for every folder are always on the phone. Turn a folder on to also download message bodies and attachments ahead of time.',
                  style: theme.textTheme.bodySmall),
            ),
            for (final f in mail.folders.where((f) => f.role != 'all'))
              SwitchListTile(
                title: Text(f.name),
                subtitle: mail.accounts.length > 1 ? Text(mail.accountById(f.accountId)?.email ?? '') : null,
                value: f.offline,
                onChanged: (v) => mail.setFolderOffline(f.id, v),
              ),
            heading('Sync queue', key: _queueKey),
            if (queue.isEmpty)
              const ListTile(leading: Icon(Icons.cloud_done_outlined), title: Text('Everything is synced'))
            else
              for (final item in queue)
                ListTile(
                  leading: Icon(item.status == 'failed' ? Icons.error_outline : Icons.cloud_upload_outlined,
                      color: item.status == 'failed' ? theme.colorScheme.error : null),
                  title: Text(item.describe),
                  subtitle: Text([
                    mail.accountById(item.accountId)?.email ?? '',
                    listDate(item.createdAt),
                    if (item.lastError.isNotEmpty) item.lastError,
                  ].where((s) => s.isNotEmpty).join(' · '), maxLines: 3, overflow: TextOverflow.ellipsis),
                  trailing: item.status == 'failed'
                      ? Row(mainAxisSize: MainAxisSize.min, children: [
                          IconButton(tooltip: 'Retry', icon: const Icon(Icons.refresh), onPressed: () async {
                            await mail.retry(item.id);
                            await _loadQueue();
                          }),
                          IconButton(tooltip: 'Discard and keep the server version', icon: const Icon(Icons.close), onPressed: () async {
                            await mail.discard(item.id);
                            await _loadQueue();
                          }),
                        ])
                      : null,
                ),
            heading('About'),
            const ListTile(title: Text('Poso for Android'), subtitle: Text('Mail is stored on this phone and synced over IMAP. Version 0.1.0')),
            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }
}
