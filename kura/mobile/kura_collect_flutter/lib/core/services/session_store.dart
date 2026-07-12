import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class SessionStore {
  static const _storage = FlutterSecureStorage();

  static Future<void> save({
    required String baseUrl,
    required String token,
    required String username,
  }) async {
    await _storage.write(key: 'base_url', value: baseUrl);
    await _storage.write(key: 'token', value: token);
    await _storage.write(key: 'username', value: username);
  }

  static Future<String?> get baseUrl => _storage.read(key: 'base_url');
  static Future<String?> get token => _storage.read(key: 'token');
  static Future<String?> get username => _storage.read(key: 'username');

  static Future<void> clear() => _storage.deleteAll();
}
