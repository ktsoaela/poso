import 'package:flutter/material.dart';

import '../app.dart';
import '../data/models.dart';
import 'format.dart';

class Avatar extends StatelessWidget {
  const Avatar({super.key, required this.name, required this.email, this.size = 40});
  final String name;
  final String email;
  final double size;

  static const _palette = [Color(0xFF4F46E5), Color(0xFF0EA5E9), Color(0xFF10B981), Color(0xFF8B5CF6), Color(0xFFF43F5E), Color(0xFFF59E0B), Color(0xFF14B8A6)];

  @override
  Widget build(BuildContext context) {
    final key = (email.isNotEmpty ? email : name).toLowerCase();
    final color = _palette[key.codeUnits.fold<int>(0, (a, b) => (a * 31 + b) & 0x7fffffff) % _palette.length];
    return CircleAvatar(
      radius: size / 2,
      backgroundColor: color.withValues(alpha: 0.16),
      child: Text(initials(name, email), style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: size * 0.36)),
    );
  }
}

class MessageTile extends StatelessWidget {
  const MessageTile({super.key, required this.message, required this.onTap, this.showAccount = false});
  final Message message;
  final VoidCallback onTap;
  final bool showAccount;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final unread = !message.seen;
    final outgoing = message.folderRole == 'sent' || message.folderRole == 'drafts';
    final who = outgoing ? (message.to.isEmpty ? '(no recipients)' : 'To: ${message.to.map((a) => a.display).join(', ')}') : message.sender;
    final weight = unread ? FontWeight.w700 : FontWeight.w500;
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 10, 16, 10),
        decoration: showAccount
            ? BoxDecoration(border: Border(left: BorderSide(color: hexColor(message.accountColor), width: 3)))
            : null,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Avatar(name: outgoing && message.to.isNotEmpty ? message.to.first.name : message.fromName, email: outgoing && message.to.isNotEmpty ? message.to.first.email : message.fromEmail),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    Expanded(child: Text(who, maxLines: 1, overflow: TextOverflow.ellipsis, style: theme.textTheme.bodyLarge?.copyWith(fontWeight: weight))),
                    if (message.pending > 0)
                      Padding(
                        padding: const EdgeInsets.only(left: 6),
                        child: Icon(Icons.cloud_upload_outlined, size: 15, color: theme.colorScheme.outline, semanticLabel: 'Waiting to sync'),
                      ),
                    if (message.flagged) const Padding(padding: EdgeInsets.only(left: 6), child: Icon(Icons.flag, size: 16, color: Color(0xFFF59E0B))),
                    const SizedBox(width: 8),
                    Text(listDate(message.date),
                        style: theme.textTheme.labelSmall?.copyWith(color: unread ? theme.colorScheme.primary : theme.colorScheme.outline, fontWeight: weight)),
                  ]),
                  const SizedBox(height: 2),
                  Text(message.subject.isEmpty ? '(no subject)' : message.subject,
                      maxLines: 1, overflow: TextOverflow.ellipsis, style: theme.textTheme.bodyMedium?.copyWith(fontWeight: weight)),
                  if (message.snippet.isNotEmpty)
                    Text(message.snippet, maxLines: 1, overflow: TextOverflow.ellipsis, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
