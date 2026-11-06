import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../app.dart';
import '../data/models.dart';
import '../services/connectivity_service.dart';
import '../services/mailbox.dart';
import '../widgets/format.dart';
import '../widgets/message_tile.dart';
import 'account_screen.dart';
import 'compose_screen.dart';
import 'reader_screen.dart';
import 'search_screen.dart';
import 'settings_screen.dart';

class InboxScreen extends StatelessWidget {
  const InboxScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final mail = context.watch<Mailbox>();
    final online = context.watch<ConnectivityService>().online;
    final session = mail.activeSession!;
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(mail.title),
            Text(session.name, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: hexColor(session.color))),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Search',
            icon: const Icon(Icons.search),
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SearchScreen())),
          ),
          _SyncButton(online: online),
        ],
      ),
      drawer: const _MailDrawer(),
      floatingActionButton: mail.accounts.isEmpty
          ? null
          : FloatingActionButton.extended(
              onPressed: () => openCompose(context),
              icon: const Icon(Icons.edit_outlined),
              label: const Text('Compose'),
            ),
      body: Column(
        children: [
          _StatusBanner(online: online),
          Expanded(child: mail.accounts.isEmpty ? const _NoAccounts() : const _MessageList()),
        ],
      ),
    );
  }
}

class _SyncButton extends StatelessWidget {
  const _SyncButton({required this.online});
  final bool online;

  @override
  Widget build(BuildContext context) {
    final mail = context.watch<Mailbox>();
    if (mail.syncing) {
      return const Padding(padding: EdgeInsets.all(14), child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)));
    }
    return IconButton(
      tooltip: online ? 'Sync now' : 'Offline',
      icon: Badge(
        isLabelVisible: mail.pendingCount > 0,
        label: Text('${mail.pendingCount}'),
        child: Icon(online ? Icons.sync : Icons.cloud_off_outlined),
      ),
      onPressed: online ? () => mail.refresh() : null,
    );
  }
}

class _StatusBanner extends StatelessWidget {
  const _StatusBanner({required this.online});
  final bool online;

  @override
  Widget build(BuildContext context) {
    final mail = context.watch<Mailbox>();
    final scheme = Theme.of(context).colorScheme;
    String? text;
    IconData icon = Icons.cloud_off_outlined;
    Color color = scheme.surfaceContainerHighest;
    if (mail.failedCount > 0) {
      text = '${mail.failedCount} change${mail.failedCount == 1 ? '' : 's'} could not sync. Tap to review.';
      icon = Icons.error_outline;
      color = scheme.errorContainer;
    } else if (!online) {
      text = mail.pendingCount > 0
          ? 'Offline · ${mail.pendingCount} change${mail.pendingCount == 1 ? '' : 's'} will sync when you reconnect'
          : 'Offline · showing mail saved on this phone';
    } else if (mail.pendingCount > 0) {
      text = 'Syncing ${mail.pendingCount} change${mail.pendingCount == 1 ? '' : 's'}…';
      icon = Icons.cloud_upload_outlined;
    } else if (mail.syncError != null) {
      text = mail.syncError;
      icon = Icons.warning_amber_outlined;
      color = scheme.errorContainer;
    }
    if (text == null) return const SizedBox.shrink();
    return Material(
      color: color,
      child: InkWell(
        onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SettingsScreen(scrollToQueue: true))),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(children: [
            Icon(icon, size: 18),
            const SizedBox(width: 10),
            Expanded(child: Text(text, style: Theme.of(context).textTheme.bodySmall, maxLines: 2, overflow: TextOverflow.ellipsis)),
          ]),
        ),
      ),
    );
  }
}

class _NoAccounts extends StatelessWidget {
  const _NoAccounts();

  @override
  Widget build(BuildContext context) {
    final mail = context.watch<Mailbox>();
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.mail_outline, size: 56, color: Theme.of(context).colorScheme.primary),
          const SizedBox(height: 16),
          Text('${mail.activeSession!.name} has no accounts yet', style: Theme.of(context).textTheme.titleMedium, textAlign: TextAlign.center),
          const SizedBox(height: 8),
          const Text('Add an IMAP account. Mail syncs to this phone so you can read, search and reply offline.', textAlign: TextAlign.center),
          const SizedBox(height: 20),
          FilledButton.icon(
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => AccountScreen(sessionId: mail.sessionId))),
            icon: const Icon(Icons.person_add_alt),
            label: const Text('Add account'),
          ),
        ]),
      ),
    );
  }
}

class _MessageList extends StatelessWidget {
  const _MessageList();

  @override
  Widget build(BuildContext context) {
    final mail = context.watch<Mailbox>();
    final drafts = mail.view.role == 'drafts' ? mail.drafts : const <Draft>[];
    final multi = mail.accounts.length > 1;
    final count = drafts.length + mail.messages.length;
    return RefreshIndicator(
      onRefresh: () => mail.refresh(),
      child: count == 0
          ? ListView(children: [
              const SizedBox(height: 120),
              Icon(Icons.inbox_outlined, size: 48, color: Theme.of(context).colorScheme.outline),
              const SizedBox(height: 12),
              Center(child: Text(mail.syncing ? 'Syncing…' : 'Nothing in ${mail.title}', style: Theme.of(context).textTheme.bodyLarge)),
            ])
          : ListView.separated(
              padding: const EdgeInsets.only(bottom: 88),
              itemCount: count,
              separatorBuilder: (_, _) => const Divider(height: 1, indent: 64),
              itemBuilder: (context, index) {
                if (index < drafts.length) return _DraftTile(draft: drafts[index]);
                final message = mail.messages[index - drafts.length];
                return _Swipeable(
                  message: message,
                  child: MessageTile(
                    message: message,
                    showAccount: multi,
                    onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ReaderScreen(messageId: message.id))),
                  ),
                );
              },
            ),
    );
  }
}

class _DraftTile extends StatelessWidget {
  const _DraftTile({required this.draft});
  final Draft draft;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListTile(
      leading: CircleAvatar(backgroundColor: theme.colorScheme.tertiaryContainer, child: const Icon(Icons.edit_note)),
      title: Text(draft.to.isEmpty ? '(no recipients)' : 'To: ${draft.to}', maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: Text(draft.subject.isEmpty ? '(no subject)' : draft.subject, maxLines: 1, overflow: TextOverflow.ellipsis),
      trailing: Text(listDate(draft.updatedAt), style: theme.textTheme.labelSmall),
      onTap: () => openCompose(context, draft: draft),
    );
  }
}

class _Swipeable extends StatelessWidget {
  const _Swipeable({required this.message, required this.child});
  final Message message;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final mail = context.read<Mailbox>();
    final scheme = Theme.of(context).colorScheme;
    final canArchive = message.folderRole == 'inbox';
    Widget bg(Alignment align, IconData icon, Color color) => Container(
          color: color,
          alignment: align,
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Icon(icon, color: Colors.white),
        );
    return Dismissible(
      key: ValueKey('m${message.id}'),
      direction: canArchive ? DismissDirection.horizontal : DismissDirection.endToStart,
      background: bg(Alignment.centerLeft, Icons.archive_outlined, scheme.primary),
      secondaryBackground: bg(Alignment.centerRight, Icons.delete_outline, scheme.error),
      confirmDismiss: (direction) async {
        final messenger = ScaffoldMessenger.of(context);
        if (direction == DismissDirection.startToEnd) {
          final moved = await mail.moveToRole([message.id], 'archive');
          if (moved == 0) messenger.showSnackBar(const SnackBar(content: Text('This account has no Archive folder yet. Sync first.')));
        } else {
          await mail.delete([message.id]);
          messenger.showSnackBar(SnackBar(content: Text(message.folderRole == 'trash' || message.folderRole == 'spam' ? 'Deleted forever' : 'Moved to Trash')));
        }
        return false; // the list reloads from SQLite
      },
      child: child,
    );
  }
}

class _MailDrawer extends StatelessWidget {
  const _MailDrawer();

  static const _roles = [
    ('inbox', Icons.inbox_outlined),
    ('flagged', Icons.flag_outlined),
    ('drafts', Icons.drafts_outlined),
    ('sent', Icons.send_outlined),
    ('archive', Icons.archive_outlined),
    ('spam', Icons.report_gmailerrorred_outlined),
    ('trash', Icons.delete_outline),
  ];

  @override
  Widget build(BuildContext context) {
    final mail = context.watch<Mailbox>();
    final theme = Theme.of(context);
    void go(MailView view) {
      Navigator.of(context).pop();
      mail.setView(view);
    }

    return NavigationDrawer(
      selectedIndex: null,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: SegmentedButton<int>(
            segments: [for (final s in mail.sessions) ButtonSegment(value: s.id, label: Text(s.name), icon: Icon(s.name == 'Personal' ? Icons.home_outlined : Icons.work_outline))],
            selected: {mail.sessionId},
            onSelectionChanged: (value) {
              Navigator.of(context).pop();
              mail.switchSession(value.first);
            },
          ),
        ),
        for (final (role, icon) in _roles)
          _DrawerItem(
            icon: icon,
            label: roleTitles[role]!,
            count: role == 'inbox' ? mail.unreadFor('inbox') : role == 'drafts' ? mail.drafts.length : role == 'spam' ? mail.unreadFor('spam') : 0,
            selected: mail.view == MailView.role(role),
            onTap: () => go(MailView.role(role)),
          ),
        for (final account in mail.accounts) ...[
          const Divider(indent: 16, endIndent: 16),
          Padding(
            padding: const EdgeInsets.fromLTRB(28, 4, 16, 4),
            child: Row(children: [
              CircleAvatar(radius: 5, backgroundColor: hexColor(account.color)),
              const SizedBox(width: 10),
              Expanded(child: Text(account.email, style: theme.textTheme.labelMedium, overflow: TextOverflow.ellipsis)),
              if (account.lastError.isNotEmpty) Icon(Icons.error_outline, size: 16, color: theme.colorScheme.error),
            ]),
          ),
          for (final folder in mail.folders.where((f) => f.accountId == account.id && (f.role == 'inbox' || f.role == 'custom')))
            _DrawerItem(
              icon: folder.role == 'inbox' ? Icons.inbox_outlined : Icons.folder_outlined,
              label: folder.name,
              count: folder.unread,
              offline: folder.offline,
              selected: mail.view == MailView.folder(folder.id),
              onTap: () => go(MailView.folder(folder.id)),
            ),
        ],
        const Divider(indent: 16, endIndent: 16),
        _DrawerItem(
          icon: Icons.person_add_alt,
          label: 'Add account',
          onTap: () {
            Navigator.of(context).pop();
            Navigator.of(context).push(MaterialPageRoute(builder: (_) => AccountScreen(sessionId: mail.sessionId)));
          },
        ),
        _DrawerItem(
          icon: Icons.settings_outlined,
          label: 'Settings',
          onTap: () {
            Navigator.of(context).pop();
            Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SettingsScreen()));
          },
        ),
        const SizedBox(height: 16),
      ],
    );
  }
}

class _DrawerItem extends StatelessWidget {
  const _DrawerItem({required this.icon, required this.label, required this.onTap, this.count = 0, this.selected = false, this.offline = false});
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final int count;
  final bool selected;
  final bool offline;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: ListTile(
        dense: true,
        selected: selected,
        selectedTileColor: scheme.secondaryContainer,
        shape: const StadiumBorder(),
        leading: Icon(icon),
        title: Text(label, overflow: TextOverflow.ellipsis),
        trailing: Row(mainAxisSize: MainAxisSize.min, children: [
          if (offline) Icon(Icons.offline_pin_outlined, size: 16, color: scheme.outline),
          if (count > 0) Padding(padding: const EdgeInsets.only(left: 6), child: Text('$count', style: Theme.of(context).textTheme.labelMedium)),
        ]),
        onTap: onTap,
      ),
    );
  }
}
