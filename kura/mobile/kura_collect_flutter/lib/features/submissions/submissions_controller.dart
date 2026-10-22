import 'package:flutter/foundation.dart';

import '../../core/database/app_database.dart';
import '../../core/models/submission_model.dart';
import '../../core/services/sync_engine.dart';

/// Local records list. Sync itself lives in [SyncEngine]; this controller
/// keeps its old API (sync / syncing / pending) so existing screens work,
/// and reloads automatically whenever the engine changes records.
class SubmissionsController extends ChangeNotifier {
  SubmissionsController(this.database) {
    SyncEngine.instance.addListener(_onEngine);
  }

  final AppDatabase database;

  List<LocalSubmission> submissions = <LocalSubmission>[];
  int pending = 0;
  int _seenRevision = -1;

  bool get syncing => SyncEngine.instance.busy;

  void _onEngine() {
    final rev = SyncEngine.instance.revision;
    if (rev != _seenRevision) {
      _seenRevision = rev;
      load();
    } else {
      notifyListeners(); // progress / phase changed
    }
  }

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
    // A finished form syncs straight away when the phone is online.
    await SyncEngine.instance
        .recordsChanged(justFinished: submission.status != 'draft');
  }

  Future<void> delete(String uuid) async {
    await database.deleteSubmission(uuid);
    await load();
    await SyncEngine.instance.recordsChanged();
  }

  /// Manual "Sync now" — returns how many records were sent.
  Future<int> sync() async {
    final report = await SyncEngine.instance.syncNow();
    await load();
    return report?.synced ?? 0;
  }

  Future<void> retry(String uuid) async {
    await SyncEngine.instance.retry(uuid: uuid);
    await load();
  }

  @override
  void dispose() {
    SyncEngine.instance.removeListener(_onEngine);
    super.dispose();
  }
}
