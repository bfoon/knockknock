import 'dart:convert';

class LocalSubmission {
  final String uuid;
  final String formCode;
  final int version;
  final Map<String, dynamic> answers;
  final String status;
  final String syncStatus;
  final DateTime startedAt;
  final DateTime? submittedAt;
  final int durationMs;
  final double? gpsLat;
  final double? gpsLng;
  final String? error;

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
  });

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
