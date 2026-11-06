import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:provider/provider.dart';

import 'app.dart';
import 'data/db.dart';
import 'services/connectivity_service.dart';
import 'services/mailbox.dart';
import 'services/offline_store.dart';
import 'services/secret_store.dart';
import 'services/sync_engine.dart';
import 'services/transport.dart';

/// Opens entirely from local storage: settings (Hive), the mailbox (SQLite) and passwords
/// (secure storage). Nothing here waits on the network.
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final store = await OfflineStore.init();
  final support = await getApplicationSupportDirectory();
  final db = await MailDb.open(p.join(support.path, 'mail.db'));
  final secrets = DeviceSecretStore();
  const connector = EnoughMailConnector();
  final connectivity = ConnectivityService();
  final sync = SyncEngine(db, secrets, connector, support.path);
  final mailbox = Mailbox(db: db, store: store, secrets: secrets, connector: connector, sync: sync, isOnline: () => connectivity.online);
  await mailbox.init();

  connectivity.cameOnline.listen((_) => mailbox.onOnline());
  mailbox.refresh(quiet: true);

  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: connectivity),
        ChangeNotifierProvider.value(value: mailbox),
      ],
      child: const PosoApp(),
    ),
  );
}
