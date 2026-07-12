import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';

import '../database/app_database.dart';
import '../models/submission_model.dart';
import 'api_client.dart';

class SyncService {
  final AppDatabase database;
  final ApiClient api;

  SyncService(
    this.database, {
    ApiClient? api,
  }) : api = api ?? ApiClient();

  Future<int> syncAll() async {
    final connectivityResults =
        await Connectivity().checkConnectivity();

    final hasConnection = connectivityResults.any(
      (result) => result != ConnectivityResult.none,
    );

    if (!hasConnection) {
      return 0;
    }

    final List<LocalSubmission> pending =
        await database.getPendingSubmissions();

    final Map<String, List<LocalSubmission>> grouped =
        <String, List<LocalSubmission>>{};

    for (final LocalSubmission submission in pending) {
      grouped
          .putIfAbsent(
            submission.formCode,
            () => <LocalSubmission>[],
          )
          .add(submission);
    }

    int synced = 0;

    for (final MapEntry<String, List<LocalSubmission>> entry
        in grouped.entries) {
      final String formCode = entry.key;
      final List<LocalSubmission> batch = entry.value;

      try {
        final Map<String, dynamic> response =
            await api.syncBatch(formCode, batch);

        final List<dynamic> results =
            response['results'] is List
                ? response['results'] as List<dynamic>
                : <dynamic>[];

        final Set<String> processedUuids = <String>{};

        for (final dynamic item in results) {
          if (item is! Map) {
            continue;
          }

          final Map<String, dynamic> resultMap =
              Map<String, dynamic>.from(item);

          final String? uuid =
              resultMap['uuid']?.toString();

          if (uuid == null || uuid.isEmpty) {
            continue;
          }

          processedUuids.add(uuid);

          final String result =
              resultMap['result']?.toString() ?? '';

          if (result == 'created' ||
              result == 'duplicate' ||
              result == 'updated') {
            await database.updateSubmissionSync(
              uuid,
              'synced',
            );

            synced++;
          } else {
            await database.updateSubmissionSync(
              uuid,
              'failed',
              error:
                  resultMap['error']?.toString() ??
                  resultMap['message']?.toString() ??
                  'Submission was rejected by the server.',
            );
          }
        }

        for (final LocalSubmission submission in batch) {
          if (!processedUuids.contains(submission.uuid)) {
            await database.updateSubmissionSync(
              submission.uuid,
              'failed',
              error:
                  'The server did not return a sync result for this submission.',
            );
          }
        }
      } catch (error, stackTrace) {
        for (final LocalSubmission submission in batch) {
          await database.updateSubmissionSync(
            submission.uuid,
            'failed',
            error: error.toString(),
          );
        }

        // Visible in GitHub Actions and local debug logs.
        print(
          'Failed to sync form $formCode: $error\n'
          '$stackTrace',
        );
      }
    }

    return synced;
  }
}