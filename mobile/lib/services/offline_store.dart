import 'package:hive_flutter/hive_flutter.dart';

/// Small settings store (Hive), as in Lipina. The mailbox itself lives in SQLite (MailDb) and
/// passwords live in SecretStore. This only remembers what the app needs to open offline.
class OfflineStore {
  OfflineStore.withBox(this.settings);

  final Box settings;

  static Future<OfflineStore> init() async {
    await Hive.initFlutter('poso');
    return OfflineStore.withBox(await Hive.openBox('settings'));
  }

  int? get activeSessionId => settings.get('active_session_id') as int?;
  set activeSessionId(int? value) => value == null ? settings.delete('active_session_id') : settings.put('active_session_id', value);

  /// Last mailbox the user looked at, e.g. `role:inbox` or `folder:12`, restored on launch.
  String get lastView => settings.get('last_view', defaultValue: 'role:inbox') as String;
  set lastView(String value) => settings.put('last_view', value);
}
