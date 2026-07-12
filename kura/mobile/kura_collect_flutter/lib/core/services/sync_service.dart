import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';

import '../database/app_database.dart';
import 'api_client.dart';

class SyncService {
  final AppDatabase database;
  final ApiClient api;

  SyncService(this.database, {ApiClient? api}) : api = api ?? ApiClient();

  Future<int> syncAll() async {
    final connectivity = await Connectivity().checkConnectivity();
    if (connectivity.every((item) => item == ConnectivityResult.none)) {
      return 0;
    }

    final pending = await database.getPendingSubmissions();
    final grouped = <String, List<dynamic>>{};
    for (final submission in pending) {
      grouped.putIfAbsent(submission.formCode, () => []).add(submission);
    }

    var synced = 0;
    for (final entry in grouped.entries) {
      final batch = entry.value.cast();
      try {
        final response = await api.syncBatch(entry.key, batch);
        final results = (response['results'] as List? ?? []);
        for (final item in results) {
          final map = Map<String, dynamic>.from(item as Map);
          final uuid = map['uuid']?.toString();
          if (uuid == null) continue;
          final result = map['result']?.toString();
          if (result == 'created' || result == 'duplicate') {
            await database.updateSubmissionSync(uuid, 'synced');
            synced += 1;
          } else {
            await database.updateSubmissionSync(
              uuid,
              'failed',
              error: map['error']?.toString() ?? 'Rejected by server',
            );
          }
        }
      } catch (error) {
        for (final submission in batch) {
          await database.updateSubmissionSync(
            submission.uuid,
            'failed',
            error: error.toString(),
          );
        }
      }
    }
    return synced;
  }
}
