import 'dart:convert';

import 'package:path/path.dart';
import 'package:sqflite/sqflite.dart';

import '../models/form_model.dart';
import '../models/submission_model.dart';

/// Local store for Kura Collect.
///
/// Sync states (submissions.sync_status):
///   draft    — still being filled in, never synced
///   pending  — finished, waiting to go to the server
///   retry    — a send failed for a temporary reason (no signal, server
///              busy); retried automatically after `next_retry_at`
///   failed   — the server REJECTED it (validation) — needs a person; it is
///              not retried automatically, only via "Retry"
///   synced   — safely on the server
///
/// v2 adds retry bookkeeping, an offline queue for live GPS streaming and
/// crash-safe storage for in-progress map traces.
class AppDatabase {
  Database? _db;

  static const _version = 2;

  Future<void> initialize() async {
    if (_db != null) return;
    final path = join(await getDatabasesPath(), 'kura_collect.db');
    _db = await openDatabase(
      path,
      version: _version,
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE forms(
            code TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            version INTEGER NOT NULL,
            schema_hash TEXT,
            access_status TEXT NOT NULL,
            allowed INTEGER NOT NULL,
            is_open INTEGER NOT NULL,
            schema_json TEXT,
            downloaded_at TEXT
          )
        ''');
        await db.execute('''
          CREATE TABLE submissions(
            uuid TEXT PRIMARY KEY,
            form_code TEXT NOT NULL,
            version INTEGER NOT NULL,
            answers_json TEXT NOT NULL,
            status TEXT NOT NULL,
            sync_status TEXT NOT NULL,
            started_at TEXT NOT NULL,
            submitted_at TEXT,
            duration_ms INTEGER NOT NULL,
            gps_lat REAL,
            gps_lng REAL,
            error TEXT,
            attempts INTEGER NOT NULL DEFAULT 0,
            next_retry_at TEXT,
            synced_at TEXT
          )
        ''');
        await _createV2Tables(db);
      },
      onUpgrade: (db, oldVersion, newVersion) async {
        if (oldVersion < 2) {
          await db.execute(
              'ALTER TABLE submissions ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0');
          await db.execute(
              'ALTER TABLE submissions ADD COLUMN next_retry_at TEXT');
          await db.execute('ALTER TABLE submissions ADD COLUMN synced_at TEXT');
          // v1 marked every network error as "failed". Give those records a
          // clean retry — the new engine only uses "failed" for real
          // server rejections.
          await db.execute(
              "UPDATE submissions SET sync_status='pending', error=NULL "
              "WHERE sync_status='failed'");
          await _createV2Tables(db);
        }
      },
    );
  }

  Future<void> _createV2Tables(Database db) async {
    // Live GPS batches waiting for a connection (sent in order per session).
    await db.execute('''
      CREATE TABLE IF NOT EXISTS live_queue(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        form_code TEXT NOT NULL,
        session TEXT NOT NULL,
        seq INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    ''');
    await db.execute(
        'CREATE INDEX IF NOT EXISTS live_queue_session ON live_queue(session, seq)');
    // An in-progress map recording, saved after every GPS point so a crash,
    // a phone call or a closed app never loses the walk.
    await db.execute('''
      CREATE TABLE IF NOT EXISTS trace_sessions(
        key TEXT PRIMARY KEY,
        form_code TEXT NOT NULL,
        question TEXT NOT NULL,
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    ''');
  }

  Database get db {
    final value = _db;
    if (value == null) throw StateError('Database not initialized');
    return value;
  }

  // ── forms ─────────────────────────────────────────────────────────────

  Future<void> upsertForm(KuraForm form) async {
    await db.insert(
      'forms',
      form.toDb(),
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<List<KuraForm>> getForms() async {
    final rows = await db.query('forms', orderBy: 'title COLLATE NOCASE');
    return rows.map(KuraForm.fromDb).toList();
  }

  Future<KuraForm?> getForm(String code) async {
    final rows = await db.query(
      'forms',
      where: 'code = ?',
      whereArgs: [code.toUpperCase()],
      limit: 1,
    );
    return rows.isEmpty ? null : KuraForm.fromDb(rows.first);
  }

  // ── submissions ───────────────────────────────────────────────────────

  Future<void> saveSubmission(LocalSubmission submission) async {
    await db.insert(
      'submissions',
      submission.toDb(),
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<void> deleteSubmission(String uuid) async {
    await db.delete(
      'submissions',
      where: 'uuid = ?',
      whereArgs: [uuid],
    );
  }

  Future<List<LocalSubmission>> getSubmissions({String? formCode}) async {
    final rows = await db.query(
      'submissions',
      where: formCode == null ? null : 'form_code = ?',
      whereArgs: formCode == null ? null : [formCode],
      orderBy: 'started_at DESC',
    );
    return rows.map(LocalSubmission.fromDb).toList();
  }

  /// Records the automatic sync should send now: pending ones, plus retries
  /// whose back-off has elapsed. `force` (manual "Sync now") ignores the
  /// back-off. Server rejections ("failed") are never picked up here.
  Future<List<LocalSubmission>> getDueSubmissions({bool force = false}) async {
    final now = DateTime.now().toUtc().toIso8601String();
    final rows = await db.query(
      'submissions',
      where: force
          ? "sync_status IN ('pending','retry') AND status != 'draft'"
          : "status != 'draft' AND (sync_status = 'pending' OR "
              "(sync_status = 'retry' AND (next_retry_at IS NULL OR next_retry_at <= ?)))",
      whereArgs: force ? null : [now],
      orderBy: 'started_at ASC',
    );
    return rows.map(LocalSubmission.fromDb).toList();
  }

  /// Kept for older callers: everything not yet on the server.
  Future<List<LocalSubmission>> getPendingSubmissions() =>
      getDueSubmissions(force: true);

  Future<void> markSynced(String uuid) async {
    await db.update(
      'submissions',
      {
        'sync_status': 'synced',
        'error': null,
        'next_retry_at': null,
        'synced_at': DateTime.now().toUtc().toIso8601String(),
      },
      where: 'uuid = ?',
      whereArgs: [uuid],
    );
  }

  /// A temporary failure: schedule the next automatic attempt.
  Future<void> markRetry(String uuid, String error, DateTime nextAt) async {
    await db.rawUpdate(
      "UPDATE submissions SET sync_status='retry', error=?, next_retry_at=?, "
      'attempts = attempts + 1 WHERE uuid = ?',
      [error, nextAt.toUtc().toIso8601String(), uuid],
    );
  }

  /// The server rejected it — needs a person.
  Future<void> markRejected(String uuid, String error) async {
    await db.rawUpdate(
      "UPDATE submissions SET sync_status='failed', error=?, next_retry_at=NULL, "
      'attempts = attempts + 1 WHERE uuid = ?',
      [error, uuid],
    );
  }

  /// Put one record (or every rejected/waiting record) back in the queue now.
  Future<int> requeue({String? uuid}) async {
    return db.rawUpdate(
      "UPDATE submissions SET sync_status='pending', next_retry_at=NULL "
      "WHERE status != 'draft' AND sync_status IN ('failed','retry')"
      '${uuid == null ? '' : ' AND uuid = ?'}',
      uuid == null ? null : [uuid],
    );
  }

  /// Legacy helper used by older code paths.
  Future<void> updateSubmissionSync(String uuid, String syncStatus,
      {String? error}) async {
    if (syncStatus == 'synced') return markSynced(uuid);
    await db.update(
      'submissions',
      {'sync_status': syncStatus, 'error': error},
      where: 'uuid = ?',
      whereArgs: [uuid],
    );
  }

  Future<int> countPending() async {
    final result = await db.rawQuery(
      "SELECT COUNT(*) count FROM submissions "
      "WHERE sync_status IN ('pending','retry','failed') AND status != 'draft'",
    );
    return Sqflite.firstIntValue(result) ?? 0;
  }

  Future<Map<String, int>> submissionStats() async {
    final rows = await db.rawQuery(
      'SELECT sync_status, COUNT(*) count FROM submissions GROUP BY sync_status',
    );
    return {
      for (final row in rows)
        row['sync_status'] as String: (row['count'] as num).toInt(),
    };
  }

  /// When the next automatic retry is due (null when nothing is waiting).
  Future<DateTime?> nextRetryAt() async {
    final rows = await db.rawQuery(
      "SELECT MIN(next_retry_at) t FROM submissions "
      "WHERE sync_status='retry' AND status != 'draft'",
    );
    final t = rows.isEmpty ? null : rows.first['t'] as String?;
    return t == null ? null : DateTime.tryParse(t);
  }

  // ── live GPS queue ────────────────────────────────────────────────────

  Future<void> enqueueLive(
      String formCode, String session, int seq, Map<String, dynamic> payload) async {
    await db.insert('live_queue', {
      'form_code': formCode,
      'session': session,
      'seq': seq,
      'payload_json': jsonEncode(payload),
      'created_at': DateTime.now().toUtc().toIso8601String(),
    });
  }

  Future<List<Map<String, Object?>>> liveQueue({int limit = 200}) =>
      db.query('live_queue', orderBy: 'session, seq', limit: limit);

  Future<void> removeLive(int id) =>
      db.delete('live_queue', where: 'id = ?', whereArgs: [id]);

  Future<int> countLiveQueue() async =>
      Sqflite.firstIntValue(await db.rawQuery('SELECT COUNT(*) FROM live_queue')) ?? 0;

  /// Live batches older than a day are useless for live monitoring.
  Future<void> pruneLiveQueue() async {
    final cutoff =
        DateTime.now().toUtc().subtract(const Duration(hours: 24)).toIso8601String();
    await db.delete('live_queue', where: 'created_at < ?', whereArgs: [cutoff]);
  }

  // ── in-progress map traces (crash recovery) ───────────────────────────

  Future<void> saveTrace(
      String key, String formCode, String question, Map<String, dynamic> data) async {
    await db.insert(
      'trace_sessions',
      {
        'key': key,
        'form_code': formCode,
        'question': question,
        'data_json': jsonEncode(data),
        'updated_at': DateTime.now().toUtc().toIso8601String(),
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<Map<String, dynamic>?> loadTrace(String key) async {
    final rows = await db.query('trace_sessions',
        where: 'key = ?', whereArgs: [key], limit: 1);
    if (rows.isEmpty) return null;
    try {
      return Map<String, dynamic>.from(
          jsonDecode(rows.first['data_json'] as String) as Map);
    } catch (_) {
      return null;
    }
  }

  Future<void> clearTrace(String key) =>
      db.delete('trace_sessions', where: 'key = ?', whereArgs: [key]);
}
