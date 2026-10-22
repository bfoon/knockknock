import 'package:dio/dio.dart';

import '../config/api_config.dart';
import '../models/form_model.dart';
import '../models/submission_model.dart';
import 'session_store.dart';

class ApiClient {
  final Dio _dio = Dio(
    BaseOptions(
      connectTimeout: const Duration(seconds: 30),
      receiveTimeout: const Duration(seconds: 60),
      sendTimeout: const Duration(seconds: 60),
      headers: {'Accept': 'application/json'},
    ),
  );

  Future<Options> _authOptions() async {
    final token = await SessionStore.token;
    return Options(headers: {'Authorization': 'Token $token'});
  }

  Future<Map<String, dynamic>> registerDevice({
    required String baseUrl,
    required String username,
    required String password,
    required String deviceName,
  }) async {
    final response = await _dio.post(
      ApiConfig.deviceRegister(baseUrl),
      data: {
        'username': username,
        'password': password,
        'device_name': deviceName,
        'platform': 'android',
      },
    );
    return Map<String, dynamic>.from(response.data as Map);
  }

  Future<KuraForm> requestForm(String code) async {
    final baseUrl = await SessionStore.baseUrl;
    final response = await _dio.post(
      ApiConfig.formAccess(baseUrl!),
      data: {'code': code.trim().toUpperCase()},
      options: await _authOptions(),
    );
    return KuraForm.fromJson(Map<String, dynamic>.from(response.data as Map));
  }

  Future<List<KuraForm>> fetchManifest() async {
    final baseUrl = await SessionStore.baseUrl;
    final response = await _dio.get(
      ApiConfig.manifest(baseUrl!),
      options: await _authOptions(),
    );
    final data = Map<String, dynamic>.from(response.data as Map);
    return (data['forms'] as List? ?? [])
        .map((item) => KuraForm.fromJson(
            Map<String, dynamic>.from(item as Map)))
        .toList();
  }

  Future<KuraForm> downloadForm(String code) async {
    final baseUrl = await SessionStore.baseUrl;
    final response = await _dio.get(
      ApiConfig.formDetail(baseUrl!, code),
      options: await _authOptions(),
    );
    return KuraForm.fromJson(Map<String, dynamic>.from(response.data as Map));
  }

  /// One batch of live GPS points for a recording in progress.
  /// Short timeouts: a stuck request is worse than queuing the batch.
  Future<Map<String, dynamic>> postLive(
    String code,
    Map<String, dynamic> payload,
  ) async {
    final baseUrl = await SessionStore.baseUrl;
    final response = await _dio.post(
      ApiConfig.live(baseUrl!, code),
      data: payload,
      options: (await _authOptions()).copyWith(
        sendTimeout: const Duration(seconds: 12),
        receiveTimeout: const Duration(seconds: 12),
      ),
    );
    return Map<String, dynamic>.from(response.data as Map);
  }

  Future<Map<String, dynamic>> syncBatch(
    String code,
    List<LocalSubmission> submissions,
  ) async {
    final baseUrl = await SessionStore.baseUrl;
    final response = await _dio.post(
      ApiConfig.sync(baseUrl!, code),
      data: {
        'submissions': submissions.map((e) => e.toSyncJson()).toList(),
      },
      options: await _authOptions(),
    );
    return Map<String, dynamic>.from(response.data as Map);
  }
}
