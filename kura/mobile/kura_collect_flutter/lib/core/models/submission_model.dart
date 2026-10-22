import 'dart:convert';

class LocalSubmission {
  final String uuid;
  final String formCode;
  final int version;
  final Map<String, dynamic> answers;
  final String status;

  /// draft · pending · retry · failed · synced — see AppDatabase.
  final String syncStatus;
  final DateTime startedAt;
  final DateTime? submittedAt;
  final int durationMs;
  final double? gpsLat;
  final double? gpsLng;
  final String? error;

  /// How many times sending was attempted (for back-off and the UI).
  final int attempts;

  /// When the next automatic retry is due (sync_status == 'retry').
  final DateTime? nextRetryAt;

  /// When the server confirmed it.
  final DateTime? syncedAt;

  const LocalSubmission({
    required this.uuid,
    required this.formCode,
    required this.version,
    required this.answers,
    required this.status,
    required this.syncStatus,
    required this.startedAt,
    this.submittedAt,
    required this.durationMs,
    this.gpsLat,
    this.gpsLng,
    this.error,
    this.attempts = 0,
    this.nextRetryAt,
    this.syncedAt,
  });

  bool get isDraft => status == 'draft';
  bool get isSynced => syncStatus == 'synced';
  bool get needsAttention => syncStatus == 'failed';
  bool get isWaiting => syncStatus == 'pending' || syncStatus == 'retry';

  Map<String, Object?> toDb() => {
        'uuid': uuid,
        'form_code': formCode,
        'version': version,
        'answers_json': jsonEncode(answers),
        'status': status,
        'sync_status': syncStatus,
        'started_at': startedAt.toIso8601String(),
        'submitted_at': submittedAt?.toIso8601String(),
        'duration_ms': durationMs,
        'gps_lat': gpsLat,
        'gps_lng': gpsLng,
        'error': error,
        'attempts': attempts,
        'next_retry_at': nextRetryAt?.toUtc().toIso8601String(),
        'synced_at': syncedAt?.toUtc().toIso8601String(),
      };

  factory LocalSubmission.fromDb(Map<String, Object?> row) => LocalSubmission(
        uuid: row['uuid'] as String,
        formCode: row['form_code'] as String,
        version: row['version'] as int,
        answers: Map<String, dynamic>.from(
          jsonDecode(row['answers_json'] as String) as Map,
        ),
        status: row['status'] as String,
        syncStatus: row['sync_status'] as String,
        startedAt: DateTime.parse(row['started_at'] as String),
        submittedAt: row['submitted_at'] == null
            ? null
            : DateTime.tryParse(row['submitted_at'] as String),
        durationMs: row['duration_ms'] as int? ?? 0,
        gpsLat: (row['gps_lat'] as num?)?.toDouble(),
        gpsLng: (row['gps_lng'] as num?)?.toDouble(),
        error: row['error'] as String?,
        attempts: (row['attempts'] as int?) ?? 0,
        nextRetryAt: row['next_retry_at'] == null
            ? null
            : DateTime.tryParse(row['next_retry_at'] as String),
        syncedAt: row['synced_at'] == null
            ? null
            : DateTime.tryParse(row['synced_at'] as String),
      );

  Map<String, dynamic> toSyncJson() => {
        'uuid': uuid,
        'version': version,
        'answers': answers,
        'status': status,
        'started_at': startedAt.toIso8601String(),
        'submitted_at': submittedAt?.toIso8601String(),
        'duration_ms': durationMs,
        if (gpsLat != null && gpsLng != null) 'gps': [gpsLat, gpsLng],
      };
}
