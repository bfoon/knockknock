import 'package:flutter/foundation.dart';

import '../../core/config/api_config.dart';
import '../../core/database/app_database.dart';
import '../../core/services/api_client.dart';
import '../../core/services/session_store.dart';

class AuthController extends ChangeNotifier {
  final AppDatabase database;
  final ApiClient _api = ApiClient();

  bool loading = true;
  bool isAuthenticated = false;
  String? username;
  String? error;

  AuthController(this.database);

  Future<void> restoreSession() async {
    final token = await SessionStore.token;
    username = await SessionStore.username;
    isAuthenticated = token != null && token.isNotEmpty;
    loading = false;
    notifyListeners();
  }

  Future<bool> login({
    required String baseUrl,
    required String username,
    required String password,
    required String deviceName,
  }) async {
    loading = true;
    error = null;
    notifyListeners();
    try {
      final normalized = ApiConfig.normalizeBaseUrl(baseUrl);
      final response = await _api.registerDevice(
        baseUrl: normalized,
        username: username,
        password: password,
        deviceName: deviceName,
      );
      await SessionStore.save(
        baseUrl: normalized,
        token: response['token'].toString(),
        username: response['user'].toString(),
      );
      this.username = response['user'].toString();
      isAuthenticated = true;
      return true;
    } catch (e) {
      error = 'Unable to sign in. Check the server address and credentials.';
      return false;
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<void> logout() async {
    await SessionStore.clear();
    isAuthenticated = false;
    username = null;
    notifyListeners();
  }
}
