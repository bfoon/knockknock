import 'package:connectivity_plus/connectivity_plus.dart';

import '../database/app_database.dart';
import '../models/submission_model.dart';
import 'api_client.dart';

class SyncService {
  SyncService({
    required this.database,
    required this.api,
  });

  final AppDatabase database;
  final ApiClient api;

  Future<int> syncAll() async {
    final List<ConnectivityResult> connectivity =
        await Connectivity().checkConnectivity();

    final bool isOnline = connectivity.any(
      (ConnectivityResult result) =>
          result != ConnectivityResult.none,
    );

    if (!isOnline) {
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

    int syncedCount = 0;

    for (final MapEntry<String, List<LocalSubmission>> entry
        in grouped.entries) {
      final String formCode = entry.key;
      final List<LocalSubmission> batch = entry.value;

      try {
        final Map<String, dynamic> response =
            await api.syncBatch(formCode, batch);

        final dynamic responseResults = response['results'];

        final List<dynamic> results = responseResults is List
            ? responseResults
            : <dynamic>[];

        final Set<String> returnedUuids = <String>{};

        for (final dynamic item in results) {
          if (item is! Map) {
            continue;
          }

          final Map<String, dynamic> result =
              Map<String, dynamic>.from(item);

          final String uuid =
              result['uuid']?.toString() ?? '';

          if (uuid.isEmpty) {
            continue;
          }

          returnedUuids.add(uuid);

          final String status =
              result['result']?.toString() ??
              result['status']?.toString() ??
              '';

          if (status == 'created' ||
              status == 'updated' ||
              status == 'duplicate' ||
              status == 'synced' ||
              status == 'success') {
            await database.updateSubmissionSync(
              uuid,
              'synced',
            );

            syncedCount++;
          } else {
            await database.updateSubmissionSync(
              uuid,
              'failed',
              error:
                  result['error']?.toString() ??
                  result['message']?.toString() ??
                  'The server rejected this submission.',
            );
          }
        }

        for (final LocalSubmission submission in batch) {
          if (!returnedUuids.contains(submission.uuid)) {
            await database.updateSubmissionSync(
              submission.uuid,
              'failed',
              error:
                  'No result was returned by the server for this submission.',
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

        print(
          'Failed to sync form $formCode: $error\n$stackTrace',
        );
      }
    }

    return syncedCount;
  }
}