import 'package:flutter/foundation.dart';

import '../../core/database/app_database.dart';
import '../../core/models/submission_model.dart';
import '../../core/services/sync_service.dart';

class SubmissionsController extends ChangeNotifier {
  final AppDatabase database;
  List<LocalSubmission> submissions = [];
  bool syncing = false;
  int pending = 0;

  SubmissionsController(this.database);

  Future<void> load() async {
    submissions = await database.getSubmissions();
    pending = await database.countPending();
    notifyListeners();
  }

  Future<void> save(LocalSubmission submission) async {
    await database.saveSubmission(submission);
    await load();
  }

  Future<int> sync() async {
    syncing = true;
    notifyListeners();
    final count = await SyncService(database).syncAll();
    syncing = false;
    await load();
    return count;
  }
}
