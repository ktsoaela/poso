import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../data/models.dart';
import '../services/connectivity_service.dart';
import '../services/mailbox.dart';
import '../widgets/format.dart';

void openCompose(BuildContext context, {Draft? draft, ComposeInput? seed}) {
  final mail = context.read<Mailbox>();
  final input = seed ??
      (draft != null
          ? ComposeInput(
              accountId: draft.accountId,
              to: draft.to,
              cc: draft.cc,
              bcc: draft.bcc,
              subject: draft.subject,
              body: draft.body,
              inReplyTo: draft.inReplyTo,
              references: draft.references,
              draftId: draft.id,
            )
          : ComposeInput(accountId: mail.accounts.first.id));
  Navigator.of(context).push(MaterialPageRoute(builder: (_) => ComposeScreen(input: input)));
}

String _prefixed(String prefix, String subject) =>
    subject.toLowerCase().startsWith('${prefix.toLowerCase()}:') ? subject : '$prefix: $subject';

String _quote(Message m) {
  final body = m.bodyText.isEmpty ? m.snippet : m.bodyText;
  final quoted = body.split('\n').map((line) => '> $line').join('\n');
  return '\n\nOn ${fullDate(m.date)}, ${m.sender} wrote:\n$quoted';
}

void openReply(BuildContext context, Message m, {required bool all}) {
  final mail = context.read<Mailbox>();
  final own = mail.accountById(m.accountId)?.email.toLowerCase() ?? '';
  final to = <String>[if (m.fromEmail.isNotEmpty && m.fromEmail.toLowerCase() != own) m.fromName.isNotEmpty ? '${m.fromName} <${m.fromEmail}>' : m.fromEmail];
  if (to.isEmpty && m.to.isNotEmpty) to.add(m.to.first.full); // replying to our own sent mail
  final cc = all ? [...m.to, ...m.cc].where((a) => a.email.toLowerCase() != own && !to.any((t) => t.contains(a.email))).map((a) => a.full).toList() : <String>[];
  openCompose(context,
      seed: ComposeInput(
        accountId: m.accountId,
        to: to.join(', '),
        cc: cc.join(', '),
        subject: _prefixed('Re', m.subject),
        body: _quote(m),
        inReplyTo: m.messageId,
        references: [...m.references, if (m.messageId.isNotEmpty) m.messageId],
      ));
}

void openForward(BuildContext context, Message m) {
  final header = '\n\n---------- Forwarded message ----------\nFrom: ${m.fromName.isNotEmpty ? '${m.fromName} <${m.fromEmail}>' : m.fromEmail}\n'
      'Date: ${fullDate(m.date)}\nSubject: ${m.subject}\nTo: ${m.to.map((a) => a.full).join(', ')}\n\n';
  openCompose(context, seed: ComposeInput(accountId: m.accountId, subject: _prefixed('Fwd', m.subject), body: header + (m.bodyText.isEmpty ? m.snippet : m.bodyText)));
}

class ComposeScreen extends StatefulWidget {
  const ComposeScreen({super.key, required this.input});
  final ComposeInput input;

  @override
  State<ComposeScreen> createState() => _ComposeScreenState();
}

class _ComposeScreenState extends State<ComposeScreen> {
  late final TextEditingController to = TextEditingController(text: widget.input.to);
  late final TextEditingController cc = TextEditingController(text: widget.input.cc);
  late final TextEditingController bcc = TextEditingController(text: widget.input.bcc);
  late final TextEditingController subject = TextEditingController(text: widget.input.subject);
  late final TextEditingController body = TextEditingController(text: widget.input.body);
  late bool showCc = widget.input.cc.isNotEmpty || widget.input.bcc.isNotEmpty;
  Timer? _autosave;
  bool _sending = false;
  bool _done = false;

  ComposeInput get input => widget.input
    ..to = to.text
    ..cc = cc.text
    ..bcc = bcc.text
    ..subject = subject.text
    ..body = body.text;

  @override
  void initState() {
    super.initState();
    for (final c in [to, cc, bcc, subject, body]) {
      c.addListener(_scheduleSave);
    }
  }

  void _scheduleSave() {
    _autosave?.cancel();
    _autosave = Timer(const Duration(seconds: 3), () {
      if (!_done) context.read<Mailbox>().saveDraft(input);
    });
  }

  @override
  void dispose() {
    _autosave?.cancel();
    for (final c in [to, cc, bcc, subject, body]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _closeAndSave() async {
    _autosave?.cancel();
    if (_done) return;
    _done = true;
    final mail = context.read<Mailbox>();
    final messenger = ScaffoldMessenger.of(context);
    final saved = await mail.saveDraft(input);
    if (saved != null) messenger.showSnackBar(const SnackBar(content: Text('Draft saved')));
  }

  Future<void> _send() async {
    _autosave?.cancel();
    final mail = context.read<Mailbox>();
    final online = context.read<ConnectivityService>().online;
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    setState(() => _sending = true);
    try {
      await mail.send(input);
      _done = true;
      messenger.showSnackBar(SnackBar(content: Text(online ? 'Sending…' : 'Queued. It will send when you’re back online.')));
      navigator.pop();
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('$e')));
      setState(() => _sending = false);
    }
  }

  Future<void> _discard() async {
    _autosave?.cancel();
    _done = true;
    final mail = context.read<Mailbox>();
    final navigator = Navigator.of(context);
    if (widget.input.draftId != null) await mail.deleteDraft(widget.input.draftId!);
    navigator.pop();
  }

  @override
  Widget build(BuildContext context) {
    final mail = context.watch<Mailbox>();
    final accounts = mail.accounts;
    return PopScope(
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) _closeAndSave();
      },
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Compose'),
          actions: [
            IconButton(tooltip: 'Discard', icon: const Icon(Icons.delete_outline), onPressed: _discard),
            IconButton(
              tooltip: 'Send',
              icon: _sending ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.send),
              onPressed: _sending ? null : _send,
            ),
          ],
        ),
        body: ListView(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          children: [
            if (accounts.length > 1)
              DropdownButtonFormField<int>(
                initialValue: accounts.any((a) => a.id == widget.input.accountId) ? widget.input.accountId : accounts.first.id,
                decoration: const InputDecoration(labelText: 'From', border: UnderlineInputBorder()),
                items: [for (final a in accounts) DropdownMenuItem(value: a.id, child: Text(a.email))],
                onChanged: (id) => setState(() => widget.input.accountId = id ?? widget.input.accountId),
              )
            else if (accounts.isNotEmpty)
              ListTile(contentPadding: EdgeInsets.zero, dense: true, title: Text('From ${accounts.first.email}')),
            _field(to, 'To', keyboard: TextInputType.emailAddress, suffix: showCc ? null : TextButton(onPressed: () => setState(() => showCc = true), child: const Text('Cc/Bcc'))),
            if (showCc) ...[
              _field(cc, 'Cc', keyboard: TextInputType.emailAddress),
              _field(bcc, 'Bcc', keyboard: TextInputType.emailAddress),
            ],
            _field(subject, 'Subject', capitalize: true),
            TextField(
              controller: body,
              minLines: 12,
              maxLines: null,
              keyboardType: TextInputType.multiline,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(hintText: 'Write your message', border: InputBorder.none),
            ),
          ],
        ),
      ),
    );
  }

  Widget _field(TextEditingController controller, String label, {TextInputType? keyboard, Widget? suffix, bool capitalize = false}) => TextField(
        controller: controller,
        keyboardType: keyboard,
        textCapitalization: capitalize ? TextCapitalization.sentences : TextCapitalization.none,
        autocorrect: !(keyboard == TextInputType.emailAddress),
        decoration: InputDecoration(labelText: label, border: const UnderlineInputBorder(), suffixIcon: suffix),
      );
}
