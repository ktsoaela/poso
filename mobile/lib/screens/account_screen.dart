import 'dart:async';

import 'package:enough_mail/enough_mail.dart' show Discover, SocketType;
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/connectivity_service.dart';
import '../services/mailbox.dart';
import '../services/presets.dart';

/// Adds one IMAP account (Gmail with an app password, Yahoo, iCloud, or any IMAP host).
class AccountScreen extends StatefulWidget {
  const AccountScreen({super.key, required this.sessionId});
  final int sessionId;

  @override
  State<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends State<AccountScreen> {
  final email = TextEditingController();
  final password = TextEditingController();
  final name = TextEditingController();
  final username = TextEditingController();
  final imapHost = TextEditingController();
  final imapPort = TextEditingController(text: '993');
  final smtpHost = TextEditingController();
  final smtpPort = TextEditingController(text: '587');
  String smtpMode = 'starttls';
  Preset preset = presetFor('custom');
  late int sessionId = widget.sessionId;
  bool advanced = false;
  bool busy = false;
  bool lookingUp = false;
  bool hidePassword = true;
  String? error;
  Timer? _lookupTimer;
  Future<void>? _lookupFuture;

  void _apply(Preset next) {
    setState(() {
      preset = next;
      if (next.id == 'custom') {
        imapHost.clear();
        smtpHost.clear();
        imapPort.text = '993';
        smtpPort.text = '587';
        smtpMode = 'starttls';
      } else {
        imapHost.text = next.imapHost;
        imapPort.text = '${next.imapPort}';
        smtpHost.text = next.smtpHost;
        smtpPort.text = '${next.smtpPort}';
        smtpMode = next.smtpMode;
      }
      advanced = next.id == 'custom';
    });
  }

  void _scheduleLookup(String value) {
    _lookupTimer?.cancel();
    final emailAddress = value.trim();
    if (preset.id != 'custom' || !emailAddress.contains('@')) return;
    _lookupTimer = Timer(const Duration(milliseconds: 400), () {
      _lookupFuture = _lookup(emailAddress);
    });
  }

  Future<void> _lookup(String emailAddress) async {
    if (!mounted || preset.id != 'custom') return;
    setState(() => lookingUp = true);
    try {
      final config = await Discover.discover(emailAddress);
      if (!mounted || preset.id != 'custom') return;
      final incoming = config?.preferredIncomingImapServer;
      final outgoing = config?.preferredOutgoingSmtpServer ?? config?.preferredOutgoingServer;
      if (config == null || config.isFromInsecureSource || incoming == null || outgoing == null || incoming.hostname.isEmpty || outgoing.hostname.isEmpty) {
        setState(() {
          lookingUp = false;
          advanced = true;
        });
        return;
      }
      final known = _knownPreset(incoming.hostname);
      if (known != null) {
        _apply(known);
        setState(() => lookingUp = false);
        return;
      }
      setState(() {
        imapHost.text = incoming.hostname;
        imapPort.text = '${incoming.port}';
        smtpHost.text = outgoing.hostname;
        smtpPort.text = '${outgoing.port}';
        smtpMode = outgoing.socketType == SocketType.ssl ? 'ssl' : 'starttls';
        lookingUp = false;
        advanced = true;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          lookingUp = false;
          advanced = true;
        });
      }
    }
  }

  Preset? _knownPreset(String host) {
    final name = host.toLowerCase();
    if (name.endsWith('gmail.com') || name.endsWith('googlemail.com')) return presetFor('gmail');
    if (name.contains('yahoo')) return presetFor('yahoo');
    if (name.contains('office365') || name.contains('outlook.com')) return presetFor('outlook');
    if (name.endsWith('mail.me.com') || name.endsWith('icloud.com')) return presetFor('icloud');
    return null;
  }

  @override
  void dispose() {
    _lookupTimer?.cancel();
    for (final c in [email, password, name, username, imapHost, imapPort, smtpHost, smtpPort]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      busy = true;
      error = null;
    });
    final mail = context.read<Mailbox>();
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);
    try {
      if (_lookupTimer?.isActive ?? false) {
        _lookupTimer!.cancel();
        await _lookup(email.text.trim());
      } else {
        await _lookupFuture;
      }
      if (!mounted) return;
      final account = await mail.addAccount(AccountInput(
        sessionId: sessionId,
        email: email.text,
        password: mailPassword(preset.id, password.text),
        displayName: name.text,
        username: username.text,
        provider: preset.id,
        imapHost: imapHost.text,
        imapPort: int.tryParse(imapPort.text) ?? 993,
        smtpHost: smtpHost.text,
        smtpPort: int.tryParse(smtpPort.text) ?? 587,
        smtpMode: smtpMode,
      ));
      messenger.showSnackBar(SnackBar(content: Text('${account.email} added. Syncing…')));
      navigator.pop();
    } catch (e) {
      setState(() {
        busy = false;
        error = _friendly('$e');
      });
    }
  }

  String _friendly(String raw) {
    final lower = raw.toLowerCase();
    if (lower.contains('authenticationfailed') || lower.contains('invalid credentials') || lower.contains('login failed') || lower.contains('authenticate')) {
      final host = imapHost.text.toLowerCase();
      if (preset.id == 'gmail' || host.endsWith('gmail.com')) {
        return 'Gmail rejected the sign-in. Use a 16-letter app password, not your normal Google password.';
      }
      if (preset.id == 'yahoo' || host.contains('yahoo')) {
        return 'Yahoo rejected the sign-in. Use an app password, not your normal Yahoo password.';
      }
      if (preset.id == 'outlook' || host.contains('office365') || host.contains('outlook')) {
        return 'Microsoft rejected the password. Outlook and Microsoft 365 need sign-in that this phone app does not support yet.';
      }
      return 'The server rejected the email or password.';
    }
    if (lower.contains('socket') || lower.contains('host') || lower.contains('timeout')) return 'Couldn’t reach the mail server. Check the server name and your connection.';
    return raw;
  }

  @override
  Widget build(BuildContext context) {
    final mail = context.watch<Mailbox>();
    final online = context.watch<ConnectivityService>().online;
    final theme = Theme.of(context);
    const gap = SizedBox(height: 14);
    return Scaffold(
      appBar: AppBar(title: const Text('Add account')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (!online)
            Card(
              color: theme.colorScheme.errorContainer,
              child: const Padding(padding: EdgeInsets.all(12), child: Text('You’re offline. Adding an account needs a connection to check the sign-in.')),
            ),
          SegmentedButton<int>(
            segments: [for (final s in mail.sessions) ButtonSegment(value: s.id, label: Text(s.name))],
            selected: {sessionId},
            onSelectionChanged: (v) => setState(() => sessionId = v.first),
          ),
          gap,
          TextField(
            controller: email,
            keyboardType: TextInputType.emailAddress,
            autocorrect: false,
            decoration: const InputDecoration(labelText: 'Email address'),
            onChanged: (value) {
              final guess = guessPreset(value);
              if (value.contains('@') && guess.id != preset.id) _apply(guess);
              if (guess.id == 'custom') _scheduleLookup(value);
            },
          ),
          gap,
          DropdownButtonFormField<String>(
            key: ValueKey(preset.id),
            initialValue: preset.id,
            decoration: const InputDecoration(labelText: 'Provider'),
            items: [for (final p in presets) DropdownMenuItem(value: p.id, child: Text(p.label))],
            onChanged: (id) {
              final next = presetFor(id ?? 'custom');
              _apply(next);
              if (next.id == 'custom') _scheduleLookup(email.text);
            },
          ),
          Padding(padding: const EdgeInsets.fromLTRB(4, 8, 4, 0), child: Text(preset.hint, style: theme.textTheme.bodySmall)),
          gap,
          TextField(
            controller: password,
            obscureText: hidePassword,
            autocorrect: false,
            enableSuggestions: false,
            decoration: InputDecoration(
              labelText: preset.id == 'gmail' || preset.id == 'yahoo' || preset.id == 'icloud' ? 'App password' : 'Password',
              suffixIcon: IconButton(icon: Icon(hidePassword ? Icons.visibility : Icons.visibility_off), onPressed: () => setState(() => hidePassword = !hidePassword)),
            ),
          ),
          gap,
          TextField(controller: name, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Your name (optional)')),
          const SizedBox(height: 4),
          SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Server settings'), value: advanced, onChanged: (v) => setState(() => advanced = v)),
          if (advanced) ...[
            TextField(controller: username, autocorrect: false, decoration: const InputDecoration(labelText: 'Username (if not the email address)')),
            gap,
            Row(children: [
              Expanded(flex: 3, child: TextField(controller: imapHost, autocorrect: false, decoration: const InputDecoration(labelText: 'IMAP server (SSL)'))),
              const SizedBox(width: 8),
              Expanded(child: TextField(controller: imapPort, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Port'))),
            ]),
            gap,
            Row(children: [
              Expanded(flex: 3, child: TextField(controller: smtpHost, autocorrect: false, decoration: const InputDecoration(labelText: 'SMTP server'))),
              const SizedBox(width: 8),
              Expanded(child: TextField(controller: smtpPort, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Port'))),
            ]),
            gap,
            DropdownButtonFormField<String>(
              initialValue: smtpMode,
              decoration: const InputDecoration(labelText: 'SMTP security'),
              items: const [
                DropdownMenuItem(value: 'ssl', child: Text('SSL/TLS (465)')),
                DropdownMenuItem(value: 'starttls', child: Text('STARTTLS (587)')),
              ],
              onChanged: (v) => setState(() => smtpMode = v ?? smtpMode),
            ),
          ],
          if (lookingUp) const Padding(padding: EdgeInsets.only(top: 12), child: Text('Looking up this domain’s mail servers…')),
          if (error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(error!, style: TextStyle(color: theme.colorScheme.error))),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: busy ? null : _save,
            child: busy ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Sign in and add'),
          ),
          const SizedBox(height: 12),
          Text('The password is stored in this phone’s secure storage and only sent to your mail server.', style: theme.textTheme.bodySmall, textAlign: TextAlign.center),
        ],
      ),
    );
  }
}
