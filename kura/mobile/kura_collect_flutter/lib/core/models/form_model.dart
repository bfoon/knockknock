import 'dart:convert';

class KuraForm {
  final String code;
  final String title;
  final String description;
  final int version;
  final String schemaHash;
  final String accessStatus;
  final bool allowed;
  final bool isOpen;
  final Map<String, dynamic>? schema;
  final DateTime? downloadedAt;

  const KuraForm({
    required this.code,
    required this.title,
    required this.description,
    required this.version,
    required this.schemaHash,
    required this.accessStatus,
    required this.allowed,
    required this.isOpen,
    this.schema,
    this.downloadedAt,
  });

  factory KuraForm.fromJson(Map<String, dynamic> json) => KuraForm(
        code: (json['code'] ?? '').toString(),
        title: (json['title'] ?? 'Untitled form').toString(),
        description: (json['description'] ?? '').toString(),
        version: (json['version'] as num?)?.toInt() ?? 0,
        schemaHash: (json['schema_hash'] ?? '').toString(),
        accessStatus: (json['access_status'] ?? 'pending').toString(),
        allowed: json['allowed'] == true || json['access_status'] == 'allowed',
        isOpen: json['open'] != false,
        schema: json['schema'] is Map
            ? Map<String, dynamic>.from(json['schema'] as Map)
            : null,
      );

  Map<String, Object?> toDb() => {
        'code': code,
        'title': title,
        'description': description,
        'version': version,
        'schema_hash': schemaHash,
        'access_status': accessStatus,
        'allowed': allowed ? 1 : 0,
        'is_open': isOpen ? 1 : 0,
        'schema_json': schema == null ? null : jsonEncode(schema),
        'downloaded_at': downloadedAt?.toIso8601String(),
      };

  factory KuraForm.fromDb(Map<String, Object?> row) => KuraForm(
        code: row['code'] as String,
        title: row['title'] as String,
        description: (row['description'] ?? '') as String,
        version: row['version'] as int,
        schemaHash: (row['schema_hash'] ?? '') as String,
        accessStatus: (row['access_status'] ?? 'pending') as String,
        allowed: (row['allowed'] as int? ?? 0) == 1,
        isOpen: (row['is_open'] as int? ?? 1) == 1,
        schema: row['schema_json'] == null
            ? null
            : Map<String, dynamic>.from(
                jsonDecode(row['schema_json'] as String) as Map),
        downloadedAt: row['downloaded_at'] == null
            ? null
            : DateTime.tryParse(row['downloaded_at'] as String),
      );
}
