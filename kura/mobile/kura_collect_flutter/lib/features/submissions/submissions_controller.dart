import 'package:flutter/foundation.dart';

import '../../core/database/app_database.dart';
import '../../core/models/submission_model.dart';
import '../../core/services/api_client.dart';
import '../../core/services/sync_service.dart';

class SubmissionsController extends ChangeNotifier {
  SubmissionsController(this.database);

  final AppDatabase database;

  List<LocalSubmission> submissions = <LocalSubmission>[];
  bool syncing = false;
  int pending = 0;

  Future<void> load() async {
    try {
      submissions = await database.getSubmissions();
      pending = await database.countPending();
    } catch (error, stackTrace) {
      debugPrint('Failed to load submissions: $error');
      debugPrintStack(stackTrace: stackTrace);
    } finally {
      notifyListeners();
    }
  }

  Future<void> save(LocalSubmission submission) async {
    await database.saveSubmission(submission);
    await load();
  }

  Future<void> delete(String uuid) async {
    await database.deleteSubmission(uuid);
    await load();
  }

  Future<int> sync() async {
    if (syncing) {
      return 0;
    }

    syncing = true;
    notifyListeners();

    try {
      final syncService = SyncService(
        database: database,
        api: ApiClient(),
      );

      final count = await syncService.syncAll();

      await load();

      return count;
    } catch (error, stackTrace) {
      debugPrint('Submission synchronization failed: $error');
      debugPrintStack(stackTrace: stackTrace);

      rethrow;
    } finally {
      syncing = false;
      notifyListeners();
    }
  }
}