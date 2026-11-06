import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Account passwords, kept in the Android Keystore / iOS Keychain. Never written to SQLite,
/// Hive, logs or the audit log.
abstract class SecretStore {
  Future<String?> password(int accountId);
  Future<void> savePassword(int accountId, String password);
  Future<void> delete(int accountId);
}

class DeviceSecretStore implements SecretStore {
  DeviceSecretStore() : _storage = const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  String _key(int id) => 'account:$id:password';

  @override
  Future<String?> password(int accountId) => _storage.read(key: _key(accountId));

  @override
  Future<void> savePassword(int accountId, String password) => _storage.write(key: _key(accountId), value: password);

  @override
  Future<void> delete(int accountId) => _storage.delete(key: _key(accountId));
}

/// In-memory store for tests.
class MemorySecretStore implements SecretStore {
  final Map<int, String> values = {};

  @override
  Future<String?> password(int accountId) async => values[accountId];

  @override
  Future<void> savePassword(int accountId, String password) async => values[accountId] = password;

  @override
  Future<void> delete(int accountId) async => values.remove(accountId);
}
