import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';

import '../database/app_database.dart';
import 'api_client.dart';
import 'sync_service.dart';
import 'sync_settings.dart';

/// One map recording that streams to the supervisors' live map.
class LiveSession {
  LiveSession({
    required this.id,
    required this.formCode,
    required this.question,
    required this.kind,
    required this.color,
    this.label = '',
  });

  final String id;
  final String formCode;
  final String question;
  final String kind; // track | area
  final String color;
  String label;
  String status = 'recording';
  int seq = 0;
  final List<List<num>> buffer = <List<num>>[];
  bool statusDirty = true; // send the first batch even before any point
  Timer? timer;
}

/// Streams GPS points of in-progress map recordings to the server.
///
/// • Points are batched every [SyncSettings.liveIntervalSeconds] seconds.
/// • Every batch has a per-session sequence number; the server ignores
///   repeats, so re-sending after a dropped connection is always safe.
/// • Offline (or a failed send): batches go to the SQLite live_queue and are
///   flushed IN ORDER when the connection returns (SyncEngine calls
///   [flushQueue] on reconnect). Batches older than 24 h are dropped —
///   they're useless for *live* monitoring; the full trace still arrives
///   with the submission.
/// • If the user switched live streaming off, nothing is sent or queued.
class LiveStreamService {
  LiveStreamService._();
  static final LiveStreamService instance = LiveStreamService._();

  AppDatabase? _db;
  ApiClient _api = ApiClient();
  SyncSettings Function() _settings = () => SyncSettings();
  final Map<String, LiveSession> _sessions = <String, LiveSession>{};
  bool _flushing = false;

  /// "live" (sending), "queued" (offline, n batches waiting), "off".
  final ValueNotifier<String> state = ValueNotifier<String>('off');
  final ValueNotifier<int> queued = ValueNotifier<int>(0);

  void configure(AppDatabase db,
      {ApiClient? api, SyncSettings Function()? settings}) {
    _db = db;
    if (api != null) _api = api;
    if (settings != null) _settings = settings;
    _refreshQueued();
  }

  bool get enabled => _settings().liveStream;

  LiveSession start({
    required String formCode,
    required String question,
    required String kind,
    required String color,
    String label = '',
  }) {
    final s = LiveSession(
      id: const Uuid().v4(),
      formCode: formCode,
      question: question,
      kind: kind,
      color: color,
      label: label,
    );
    _sessions[s.id] = s;
    final every = Duration(seconds: _settings().liveIntervalSeconds);
    s.timer = Timer.periodic(every, (_) => _tick(s));
    state.value = enabled ? 'live' : 'off';
    _tick(s);
    return s;
  }

  /// Re-attach to a session restored after a crash (keeps its id + seq).
  LiveSession resume(Map<String, dynamic> saved, String formCode, String question) {
    final s = LiveSession(
      id: saved['id']?.toString() ?? const Uuid().v4(),
      formCode: formCode,
      question: question,
      kind: saved['kind']?.toString() ?? 'track',
      color: saved['color']?.toString() ?? '#22d3ee',
    );
    s.seq = (saved['seq'] as num?)?.toInt() ?? 0;
    _sessions[s.id] = s;
    s.timer = Timer.periodic(
        Duration(seconds: _settings().liveIntervalSeconds), (_) => _tick(s));
    state.value = enabled ? 'live' : 'off';
    return s;
  }

  void addPoint(LiveSession s, List<num> point) {
    if (!enabled) return;
    s.buffer.add(point);
  }

  /// paused · recording · finished · discarded — sent immediately.
  Future<void> setStatus(LiveSession s, String status) async {
    s.status = status;
    s.statusDirty = true;
    await _tick(s);
    if (status == 'finished' || status == 'discarded') {
      s.timer?.cancel();
      _sessions.remove(s.id);
      if (_sessions.isEmpty && state.value == 'live') state.value = 'off';
    }
  }

  Future<void> _tick(LiveSession s) async {
    if (!enabled) {
      s.buffer.clear();
      return;
    }
    if (s.buffer.isEmpty && !s.statusDirty) return;
    final points = List<List<num>>.from(s.buffer);
    s.buffer.clear();
    s.statusDirty = false;
    final payload = <String, dynamic>{
      'session': s.id,
      'seq': s.seq++,
      'question': s.question,
      'kind': s.kind,
      'label': s.label,
      'color': s.color,
      'status': s.status,
      'points': points,
    };
    final db = _db;
    // Keep order: if older batches are still queued, queue this one too.
    final backlog = db == null ? 0 : await db.countLiveQueue();
    if (backlog == 0 && await SyncService.isOnline()) {
      final ok = await _send(s.formCode, payload);
      if (ok) {
        state.value = 'live';
        return;
      }
    }
    if (db != null) {
      await db.enqueueLive(s.formCode, s.id, payload['seq'] as int, payload);
      await _refreshQueued();
      state.value = 'queued';
    }
    unawaited(flushQueue());
  }

  /// true = delivered (or permanently unacceptable — don't keep retrying).
  Future<bool> _send(String formCode, Map<String, dynamic> payload) async {
    try {
      await _api.postLive(formCode, payload);
      return true;
    } on DioException catch (e) {
      final code = e.response?.statusCode;
      if (code != null && code >= 400 && code < 500 && code != 408 && code != 429) {
        // Form closed / no access / bad batch: drop it, live view is optional.
        return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  /// Send queued batches oldest-first. Stops at the first network failure.
  Future<void> flushQueue() async {
    final db = _db;
    if (db == null || _flushing || !enabled) return;
    _flushing = true;
    try {
      await db.pruneLiveQueue();
      if (!await SyncService.isOnline()) return;
      while (true) {
        final rows = await db.liveQueue(limit: 50);
        if (rows.isEmpty) break;
        for (final row in rows) {
          final payload = Map<String, dynamic>.from(
              _decode(row['payload_json'] as String));
          final ok = await _send(row['form_code'] as String, payload);
          if (!ok) return;
          await db.removeLive(row['id'] as int);
        }
      }
      if (_sessions.isNotEmpty) state.value = 'live';
    } finally {
      _flushing = false;
      await _refreshQueued();
    }
  }

  Future<void> _refreshQueued() async {
    final db = _db;
    if (db == null) return;
    queued.value = await db.countLiveQueue();
    if (queued.value == 0 && state.value == 'queued') {
      state.value = _sessions.isEmpty ? 'off' : 'live';
    }
  }

  Map<String, dynamic> _decode(String s) {
    try {
      return Map<String, dynamic>.from(jsonDecode(s) as Map);
    } catch (_) {
      return <String, dynamic>{};
    }
  }
}
