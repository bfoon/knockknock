import 'dart:io';
import 'dart:math' as math;

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:dio/dio.dart';

import '../database/app_database.dart';
import '../models/submission_model.dart';
import 'api_client.dart';

/// What one sync run achieved — drives the sync badge and messages.
class SyncReport {
  int attempted = 0;
  int synced = 0;
  int rejected = 0;
  int retrying = 0;
  bool offline = false;
  bool authExpired = false;

  /// form code → why the whole form is paused (closed, access pending…)
  final Map<String, String> blockedForms = <String, String>{};
  String? lastError;

  bool get hadProblems =>
      rejected > 0 || retrying > 0 || blockedForms.isNotEmpty || authExpired;

  @override
  String toString() =>
      'SyncReport(synced: $synced, rejected: $rejected, retrying: $retrying, '
      'offline: $offline, blocked: $blockedForms)';
}

/// Sends finished submissions to the server.
///
/// • Batches of [batchSize] (the server accepts at most 200 per request;
///   the old client sent everything at once and lost results past 200).
/// • Every outcome is classified:
///     created / duplicate        → synced
///     invalid (server rejected)  → failed — needs a person, not retried
///     network / timeout / 5xx    → retry with exponential back-off
///     401 / 403 / 404 / 409      → the FORM is paused (login expired,
///                                  access pending, form closed): records stay
///                                  safe and retry later, they are NOT marked
///                                  as rejected.
class SyncService {
  SyncService({
    required this.database,
    required this.api,
    this.batchSize = 50,
  });

  final AppDatabase database;
  final ApiClient api;
  final int batchSize;

  static final math.Random _rand = math.Random();

  /// Back-off: 30 s, 1 min, 2 min, 4 min … capped at 1 h, ±20 % jitter so
  /// a team of phones coming back online doesn't hit the server in lockstep.
  static DateTime nextAttempt(int attempts, {Duration? atLeast}) {
    final base = 30 * math.pow(2, attempts.clamp(0, 7)).toInt();
    var seconds = math.min(base, 3600);
    seconds = (seconds * (0.8 + _rand.nextDouble() * 0.4)).round();
    if (atLeast != null && seconds < atLeast.inSeconds) {
      seconds = atLeast.inSeconds;
    }
    return DateTime.now().add(Duration(seconds: seconds));
  }

  static Future<bool> isOnline() async {
    final results = await Connectivity().checkConnectivity();
    return results.any((r) => r != ConnectivityResult.none);
  }

  /// [force] = manual "Sync now": ignore back-off timers.
  /// [onProgress] is called with (done, total) as batches complete.
  Future<SyncReport> run({
    bool force = false,
    void Function(int done, int total)? onProgress,
  }) async {
    final report = SyncReport();
    if (!await isOnline()) {
      report.offline = true;
      return report;
    }

    final due = await database.getDueSubmissions(force: force);
    report.attempted = due.length;
    if (due.isEmpty) return report;

    final grouped = <String, List<LocalSubmission>>{};
    for (final s in due) {
      grouped.putIfAbsent(s.formCode, () => <LocalSubmission>[]).add(s);
    }

    var done = 0;
    onProgress?.call(0, due.length);

    for (final entry in grouped.entries) {
      final formCode = entry.key;
      final items = entry.value;

      for (var i = 0; i < items.length; i += batchSize) {
        final batch = items.sublist(i, math.min(i + batchSize, items.length));
        final stop = await _sendBatch(formCode, batch, report);
        done += batch.length;
        onProgress?.call(done, due.length);
        if (stop == _Stop.form) break; // form paused: skip its other batches
        if (stop == _Stop.all) return report; // offline or login expired
      }
    }
    return report;
  }

  Future<_Stop> _sendBatch(
      String formCode, List<LocalSubmission> batch, SyncReport report) async {
    // Photos go first: a record is only sent once its photos are on the
    // server, so its answers never point at an image that never arrives.
    final ready = <LocalSubmission>[];
    for (final s in batch) {
      final outcome = await _uploadPhotos(formCode, s, report);
      if (outcome == _Stop.all) return _Stop.all;
      if (outcome == _Stop.none) ready.add(s);
    }
    if (ready.isEmpty) return _Stop.none;
    batch = ready;

    try {
      final response = await api.syncBatch(formCode, batch);
      final raw = response['results'];
      final results = raw is List ? raw : const <dynamic>[];
      final seen = <String>{};

      for (final item in results) {
        if (item is! Map) continue;
        final r = Map<String, dynamic>.from(item);
        final uuid = r['uuid']?.toString() ?? '';
        if (uuid.isEmpty) continue;
        seen.add(uuid);
        final outcome = (r['result'] ?? r['status'] ?? '').toString();
        if (const {'created', 'updated', 'duplicate', 'synced', 'success'}
            .contains(outcome)) {
          await database.markSynced(uuid);
          report.synced++;
        } else {
          await database.markRejected(uuid, _rejectionText(r));
          report.rejected++;
        }
      }

      // Anything the server didn't answer for: try again later, don't
      // blame the record.
      for (final s in batch) {
        if (seen.contains(s.uuid)) continue;
        await database.markRetry(
            s.uuid,
            'The server did not confirm this record — it will be resent.',
            nextAttempt(s.attempts));
        report.retrying++;
      }
      return _Stop.none;
    } on DioException catch (e) {
      final code = e.response?.statusCode;
      final serverMsg = _serverMessage(e);

      if (code == null) {
        // No response at all: no signal, DNS, timeout, connection reset.
        for (final s in batch) {
          await database.markRetry(
              s.uuid,
              'No connection to the server — will retry automatically.',
              nextAttempt(s.attempts));
          report.retrying++;
        }
        report.offline = true;
        report.lastError = 'No connection to the server.';
        return _Stop.all;
      }

      if (code == 401) {
        report.authExpired = true;
        report.lastError = 'This device was signed out. Sign in again to sync.';
        await _pauseBatch(batch, report.lastError!, const Duration(hours: 1));
        report.retrying += batch.length;
        return _Stop.all;
      }

      if (code == 403 || code == 404 || code == 409) {
        final why = serverMsg ??
            (code == 409
                ? 'This form is not accepting submissions right now.'
                : code == 404
                    ? 'This form no longer exists on the server.'
                    : 'This device is not allowed to send to this form yet.');
        report.blockedForms[formCode] = why;
        await _pauseBatch(batch, why, const Duration(minutes: 30));
        report.retrying += batch.length;
        return _Stop.form;
      }

      if (code == 413) {
        // Too large for one request (big photos / traces): retry singly.
        if (batch.length > 1) {
          for (final s in batch) {
            final stop = await _sendBatch(formCode, [s], report);
            if (stop != _Stop.none) return stop;
          }
          return _Stop.none;
        }
        await database.markRejected(batch.first.uuid,
            'This record is too large for the server to accept.');
        report.rejected++;
        return _Stop.none;
      }

      // 429 / 5xx and anything else: the server is busy or broken — retry.
      for (final s in batch) {
        await database.markRetry(s.uuid,
            serverMsg ?? 'Server error ($code) — will retry.', nextAttempt(s.attempts));
        report.retrying++;
      }
      report.lastError = serverMsg ?? 'Server error ($code).';
      return _Stop.form;
    } catch (e) {
      for (final s in batch) {
        await database.markRetry(s.uuid, 'Sync error: $e', nextAttempt(s.attempts));
        report.retrying++;
      }
      report.lastError = e.toString();
      return _Stop.form;
    }
  }

  /// Local photo files in a record's answers, keyed by the question path the
  /// server expects: "photo" or, inside a repeat group, "group|0|photo".
  static Map<String, File> localPhotos(Map<String, dynamic> answers) {
    final out = <String, File>{};
    void consider(String key, dynamic value) {
      if (value is! String || !value.startsWith('/')) return;
      final lower = value.toLowerCase();
      final isImage = lower.endsWith('.jpg') ||
          lower.endsWith('.jpeg') ||
          lower.endsWith('.png') ||
          lower.endsWith('.webp') ||
          lower.endsWith('.heic');
      if (!isImage) return;
      final file = File(value);
      if (file.existsSync()) out[key] = file;
    }

    answers.forEach((key, value) {
      if (value is List) {
        for (var i = 0; i < value.length; i++) {
          final item = value[i];
          if (item is Map) {
            item.forEach((child, v) => consider('$key|$i|$child', v));
          }
        }
      } else {
        consider(key, value);
      }
    });
    return out;
  }

  /// Uploads the photos the server doesn't have yet.
  /// _Stop.none → send this record · _Stop.form → retry it later ·
  /// _Stop.all → offline, stop the whole run.
  Future<_Stop> _uploadPhotos(
      String formCode, LocalSubmission s, SyncReport report) async {
    final photos = localPhotos(s.answers);
    if (photos.isEmpty) return _Stop.none;
    final keys = photos.keys.toList();
    try {
      final items = <Map<String, dynamic>>[
        for (final k in keys)
          {'uuid': s.uuid, 'question': k, 'size': photos[k]!.lengthSync()},
      ];
      final missing = await api.mediaCheck(formCode, items);
      for (final i in missing) {
        if (i < 0 || i >= keys.length) continue;
        final k = keys[i];
        try {
          await api.uploadMedia(formCode,
              uuid: s.uuid, question: k, file: photos[k]!);
        } on DioException catch (e) {
          final code = e.response?.statusCode;
          if (code == 400 || code == 413) {
            // This photo can't be accepted (not a photo question, too big…).
            // Send the answers anyway instead of holding the record forever.
            report.lastError =
                'A photo was not accepted: ${_serverMessage(e) ?? code}';
            continue;
          }
          rethrow;
        }
      }
      return _Stop.none;
    } on DioException catch (e) {
      final code = e.response?.statusCode;
      if (code == null) {
        await database.markRetry(
            s.uuid,
            'No connection to the server — will retry automatically.',
            nextAttempt(s.attempts));
        report.retrying++;
        report.offline = true;
        report.lastError = 'No connection to the server.';
        return _Stop.all;
      }
      if (code == 401 || code == 403 || code == 404 || code == 409) {
        // The answers request reports the same access problem properly.
        return _Stop.none;
      }
      await database.markRetry(
          s.uuid,
          _serverMessage(e) ?? 'Photo upload failed ($code) — will retry.',
          nextAttempt(s.attempts));
      report.retrying++;
      return _Stop.form;
    } catch (e) {
      await database.markRetry(
          s.uuid, 'Photo upload error: $e', nextAttempt(s.attempts));
      report.retrying++;
      return _Stop.form;
    }
  }

  Future<void> _pauseBatch(
      List<LocalSubmission> batch, String why, Duration wait) async {
    for (final s in batch) {
      await database.markRetry(s.uuid, why, nextAttempt(s.attempts, atLeast: wait));
    }
  }

  static String _rejectionText(Map<String, dynamic> r) {
    final errors = r['validation_errors'] ?? r['errors'];
    if (errors is Map && errors.isNotEmpty) {
      return errors.entries.map((e) => '${e.key}: ${e.value}').join(' · ');
    }
    return (r['error'] ?? r['message'] ?? 'The server rejected this record.')
        .toString();
  }

  static String? _serverMessage(DioException e) {
    final data = e.response?.data;
    if (data is Map && data['error'] != null) return data['error'].toString();
    return null;
  }

  /// Compatibility with older callers (Workmanager task): returns synced count.
  Future<int> syncAll() async => (await run()).synced;
}

enum _Stop { none, form, all }
