import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/widgets.dart';

import '../database/app_database.dart';
import 'api_client.dart';
import 'live_stream_service.dart';
import 'sync_service.dart';
import 'sync_settings.dart';

enum SyncPhase { idle, syncing, offline, waitingWifi, attention, paused }

/// Decides WHEN to sync and tells the UI what's happening.
///
/// Automatic sync (when Settings → Auto-sync is on):
///   • the moment the phone comes back online (connectivity changes)
///   • right after a form is finished
///   • when the app comes back to the foreground
///   • every minute while the app is open, for retries whose back-off is due
///   • every 15 min in the background (Workmanager, see main.dart)
/// "Wi-Fi only" limits automatic sync to Wi-Fi/Ethernet; manual "Sync now"
/// and live GPS streaming still use mobile data.
///
/// Manual sync ("Sync now") ignores back-off timers and Wi-Fi-only.
class SyncEngine extends ChangeNotifier with WidgetsBindingObserver {
  SyncEngine._();
  static final SyncEngine instance = SyncEngine._();

  late AppDatabase _db;
  final ApiClient _api = ApiClient();
  SyncSettings settings = SyncSettings();

  StreamSubscription<List<ConnectivityResult>>? _connSub;
  Timer? _ticker;
  Timer? _debounce;
  bool _started = false;
  bool _running = false;
  bool _rerun = false;

  // ── state for the UI ──
  SyncPhase phase = SyncPhase.idle;
  bool online = true;
  bool onWifi = false;
  int progressDone = 0;
  int progressTotal = 0;
  DateTime? lastSuccess;
  DateTime? nextRetry;
  SyncReport? lastReport;
  String? message;
  Map<String, int> counts = <String, int>{};

  /// Bumped whenever local records change state, so lists can reload.
  int revision = 0;

  bool get busy => _running;
  int get waiting => (counts['pending'] ?? 0) + (counts['retry'] ?? 0);
  int get rejected => counts['failed'] ?? 0;
  int get synced => counts['synced'] ?? 0;

  Future<void> start(AppDatabase db) async {
    if (_started) return;
    _started = true;
    _db = db;
    settings = await SyncSettings.load();
    lastSuccess = await SyncSettings.lastSuccess();
    LiveStreamService.instance
        .configure(db, api: _api, settings: () => settings);
    WidgetsBinding.instance.addObserver(this);

    final initial = await Connectivity().checkConnectivity();
    _applyConnectivity(initial);
    _connSub = Connectivity().onConnectivityChanged.listen((results) {
      final wasOnline = online;
      _applyConnectivity(results);
      if (online && !wasOnline) {
        message = 'Back online';
        // Live GPS batches first (they're time-sensitive), then records.
        unawaited(LiveStreamService.instance.flushQueue());
        requestSync('reconnected', delay: const Duration(seconds: 2));
      }
      notifyListeners();
    });

    _ticker = Timer.periodic(const Duration(minutes: 1), (_) {
      requestSync('tick');
      unawaited(LiveStreamService.instance.flushQueue());
    });
    await refreshCounts();
    requestSync('startup', delay: const Duration(seconds: 3));
  }

  void _applyConnectivity(List<ConnectivityResult> results) {
    online = results.any((r) => r != ConnectivityResult.none);
    onWifi = results.contains(ConnectivityResult.wifi) ||
        results.contains(ConnectivityResult.ethernet);
    if (!_running) _settlePhase();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) requestSync('resumed');
  }

  /// Ask for an automatic sync (debounced; respects the settings).
  void requestSync(String reason, {Duration delay = const Duration(milliseconds: 600)}) {
    if (!_started) return;
    _debounce?.cancel();
    _debounce = Timer(delay, () => _auto(reason));
  }

  Future<void> _auto(String reason) async {
    if (!settings.autoSync) return;
    if (!online) {
      _settlePhase();
      notifyListeners();
      return;
    }
    if (settings.wifiOnly && !onWifi) {
      phase = waiting > 0 ? SyncPhase.waitingWifi : phase;
      notifyListeners();
      return;
    }
    await _run(force: false);
  }

  /// Manual "Sync now": ignores back-off and Wi-Fi-only.
  Future<SyncReport?> syncNow() async {
    if (!_started) return null;
    unawaited(LiveStreamService.instance.flushQueue());
    return _run(force: true);
  }

  /// Put rejected / waiting records back in the queue and sync them now.
  Future<SyncReport?> retry({String? uuid}) async {
    await _db.requeue(uuid: uuid);
    await refreshCounts();
    return syncNow();
  }

  Future<SyncReport?> _run({required bool force}) async {
    if (_running) {
      _rerun = true;
      return null;
    }
    _running = true;
    phase = SyncPhase.syncing;
    progressDone = 0;
    progressTotal = 0;
    message = null;
    notifyListeners();

    SyncReport? report;
    try {
      report = await SyncService(database: _db, api: _api).run(
        force: force,
        onProgress: (done, total) {
          progressDone = done;
          progressTotal = total;
          notifyListeners();
        },
      );
      lastReport = report;
      if (report.synced > 0 || (report.attempted == 0 && !report.offline)) {
        lastSuccess = DateTime.now();
        await SyncSettings.setLastSuccess(lastSuccess!);
      }
      message = _describe(report);
    } catch (e) {
      message = 'Sync error: $e';
    } finally {
      _running = false;
      await refreshCounts();
      _settlePhase(report);
      revision++;
      notifyListeners();
    }

    if (_rerun) {
      _rerun = false;
      requestSync('rerun');
    }
    return report;
  }

  String? _describe(SyncReport r) {
    if (r.offline && r.synced == 0) return 'Offline — records are safe on this phone';
    if (r.authExpired) return 'Signed out on the server — sign in again to sync';
    if (r.blockedForms.isNotEmpty) return r.blockedForms.values.first;
    if (r.synced > 0 && r.rejected == 0 && r.retrying == 0) {
      return '${r.synced} record${r.synced == 1 ? '' : 's'} sent';
    }
    if (r.rejected > 0) {
      return '${r.rejected} record${r.rejected == 1 ? '' : 's'} need${r.rejected == 1 ? 's' : ''} attention';
    }
    if (r.retrying > 0) return r.lastError ?? 'Will retry automatically';
    return null;
  }

  void _settlePhase([SyncReport? r]) {
    if (!online) {
      phase = SyncPhase.offline;
    } else if (r != null && (r.authExpired || r.blockedForms.isNotEmpty)) {
      phase = SyncPhase.paused;
    } else if (rejected > 0) {
      phase = SyncPhase.attention;
    } else if (settings.wifiOnly && !onWifi && waiting > 0) {
      phase = SyncPhase.waitingWifi;
    } else {
      phase = SyncPhase.idle;
    }
  }

  Future<void> refreshCounts() async {
    try {
      counts = await _db.submissionStats();
      nextRetry = await _db.nextRetryAt();
    } catch (_) {/* database not ready */}
  }

  /// Called by the UI after a record was saved/deleted.
  Future<void> recordsChanged({bool justFinished = false}) async {
    await refreshCounts();
    revision++;
    _settlePhase(lastReport);
    notifyListeners();
    if (justFinished) requestSync('saved', delay: const Duration(milliseconds: 300));
  }

  Future<void> updateSettings(void Function(SyncSettings s) change) async {
    change(settings);
    await settings.save();
    _settlePhase(lastReport);
    notifyListeners();
    requestSync('settings');
  }

  @override
  void dispose() {
    _connSub?.cancel();
    _ticker?.cancel();
    _debounce?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }
}
