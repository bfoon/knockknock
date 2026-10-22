import 'package:shared_preferences/shared_preferences.dart';

/// User-controlled sync behaviour (Settings → Sync).
class SyncSettings {
  SyncSettings({
    this.autoSync = true,
    this.wifiOnly = false,
    this.liveStream = true,
    this.liveIntervalSeconds = 5,
  });

  /// Send finished records automatically whenever the phone is online.
  bool autoSync;

  /// Only sync automatically on Wi-Fi (saves mobile data). Manual sync and
  /// live streaming still work on mobile data.
  bool wifiOnly;

  /// Stream GPS traces to supervisors' live map while recording.
  bool liveStream;

  /// How often a recording sends its new points.
  int liveIntervalSeconds;

  static const _kAuto = 'sync.auto';
  static const _kWifi = 'sync.wifi_only';
  static const _kLive = 'sync.live_stream';
  static const _kInterval = 'sync.live_interval';

  static Future<SyncSettings> load() async {
    final p = await SharedPreferences.getInstance();
    return SyncSettings(
      autoSync: p.getBool(_kAuto) ?? true,
      wifiOnly: p.getBool(_kWifi) ?? false,
      liveStream: p.getBool(_kLive) ?? true,
      liveIntervalSeconds: (p.getInt(_kInterval) ?? 5).clamp(2, 60),
    );
  }

  Future<void> save() async {
    final p = await SharedPreferences.getInstance();
    await p.setBool(_kAuto, autoSync);
    await p.setBool(_kWifi, wifiOnly);
    await p.setBool(_kLive, liveStream);
    await p.setInt(_kInterval, liveIntervalSeconds);
  }

  static const _kLastSync = 'sync.last_success';

  static Future<DateTime?> lastSuccess() async {
    final p = await SharedPreferences.getInstance();
    final v = p.getString(_kLastSync);
    return v == null ? null : DateTime.tryParse(v);
  }

  static Future<void> setLastSuccess(DateTime t) async {
    final p = await SharedPreferences.getInstance();
    await p.setString(_kLastSync, t.toUtc().toIso8601String());
  }
}
