/// Server presets, matching engine/session_mail/mail/presets.py (without OAuth, which the
/// phone does not do yet).
class Preset {
  const Preset(this.id, this.label, this.imapHost, this.imapPort, this.smtpHost, this.smtpPort, this.smtpMode, this.hint);
  final String id;
  final String label;
  final String imapHost;
  final int imapPort;
  final String smtpHost;
  final int smtpPort;
  final String smtpMode;
  final String hint;
}

const presets = <Preset>[
  Preset('gmail', 'Gmail', 'imap.gmail.com', 993, 'smtp.gmail.com', 465, 'ssl',
      'Gmail rejects your normal Google password. Create an app password under Google Account → Security → 2-Step Verification → App passwords, then paste it here.'),
  Preset('outlook', 'Outlook / Microsoft 365', 'outlook.office365.com', 993, 'smtp.office365.com', 587, 'starttls',
      'Outlook and Microsoft 365 have turned off password sign-in. Poso on the phone cannot use Microsoft sign-in yet.'),
  Preset('yahoo', 'Yahoo', 'imap.mail.yahoo.com', 993, 'smtp.mail.yahoo.com', 465, 'ssl',
      'Yahoo rejects your normal password. Create an app password under Yahoo Account Security → Generate app password, then paste it here.'),
  Preset('icloud', 'iCloud', 'imap.mail.me.com', 993, 'smtp.mail.me.com', 587, 'starttls', 'iCloud needs an app-specific password.'),
  Preset('custom', 'Other IMAP', '', 993, '', 587, 'starttls',
      'Work mail looks up IMAP and SMTP from your domain. If the servers stay empty, enter the hosts from your provider.'),
];

/// App passwords are shown in groups of four. A normal password can contain spaces, so only the
/// providers that issue app passwords are stripped.
String mailPassword(String provider, String raw) {
  if (provider == 'gmail' || provider == 'yahoo' || provider == 'icloud') {
    return raw.replaceAll(RegExp(r'\s+'), '');
  }
  return raw;
}

Preset presetFor(String id) => presets.firstWhere((p) => p.id == id, orElse: () => presets.last);

/// Guesses the provider from the address.
Preset guessPreset(String email) {
  final domain = email.split('@').last.toLowerCase().trim();
  if (domain == 'gmail.com' || domain == 'googlemail.com') return presetFor('gmail');
  if (const {'outlook.com', 'hotmail.com', 'live.com', 'msn.com'}.contains(domain)) return presetFor('outlook');
  if (domain.startsWith('yahoo.') || domain == 'ymail.com') return presetFor('yahoo');
  if (const {'icloud.com', 'me.com', 'mac.com'}.contains(domain)) return presetFor('icloud');
  return presetFor('custom');
}

const accountColors = ['#4f46e5', '#0ea5e9', '#10b981', '#8b5cf6', '#f43f5e', '#f59e0b'];

/// Mirrors engine/session_mail/mail/roles.py. Gmail's Starred/Important come back as `virtual`
/// and are not synced (they would duplicate other folders).
String detectRole(List<String> flags, String path, String delimiter) {
  final set = flags.map((f) => f.replaceFirst(r'\', '').toLowerCase()).toSet();
  if (set.contains('all') || set.contains('allmail')) return 'all';
  const byFlag = {'inbox': 'inbox', 'sent': 'sent', 'drafts': 'drafts', 'junk': 'spam', 'spam': 'spam', 'trash': 'trash', 'archive': 'archive'};
  for (final entry in byFlag.entries) {
    if (set.contains(entry.key)) return entry.value;
  }
  if (set.contains('flagged') || set.contains('important')) return 'virtual';
  final leaf = (delimiter.isEmpty ? path : path.split(delimiter).last).trim().toLowerCase();
  const byName = {
    'inbox': 'inbox',
    'sent': 'sent',
    'sent items': 'sent',
    'sent mail': 'sent',
    'sent messages': 'sent',
    'drafts': 'drafts',
    'draft': 'drafts',
    'junk': 'spam',
    'junk email': 'spam',
    'spam': 'spam',
    'bulk mail': 'spam',
    'trash': 'trash',
    'deleted': 'trash',
    'deleted items': 'trash',
    'deleted messages': 'trash',
    'bin': 'trash',
    'archive': 'archive',
    'archives': 'archive',
  };
  if (byName.containsKey(leaf)) return byName[leaf]!;
  if (path.toLowerCase() == 'inbox') return 'inbox';
  return 'custom';
}
