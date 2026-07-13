import 'package:path/path.dart';
import 'package:sqflite/sqflite.dart';

import '../models/form_model.dart';
import '../models/submission_model.dart';

class AppDatabase {
  Database? _db;

  Future<void> initialize() async {
    if (_db != null) return;
    final path = join(await getDatabasesPath(), 'kura_collect.db');
    _db = await openDatabase(
      path,
      version: 1,
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
            error TEXT
          )
        ''');
      },
    );
  }

  Database get db {
    final value = _db;
    if (value == null) throw StateError('Database not initialized');
    return value;
  }

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

  Future<List<LocalSubmission>> getPendingSubmissions() async {
    final rows = await db.query(
      'submissions',
      where: "sync_status IN ('pending','failed') AND status != 'draft'",
      orderBy: 'started_at ASC',
    );
    return rows.map(LocalSubmission.fromDb).toList();
  }

  Future<void> updateSubmissionSync(
    String uuid,
    String syncStatus, {
    String? error,
  }) async {
    await db.update(
      'submissions',
      {'sync_status': syncStatus, 'error': error},
      where: 'uuid = ?',
      whereArgs: [uuid],
    );
  }

  Future<int> countPending() async {
    final result = await db.rawQuery(
      "SELECT COUNT(*) count FROM submissions WHERE sync_status IN ('pending','failed') AND status != 'draft'",
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
}