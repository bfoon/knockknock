import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';

import '../../core/database/app_database.dart';
import '../../core/services/live_stream_service.dart';

/// Set by FormRunnerScreen so map questions know their form (for live
/// streaming and crash-recovery keys) and the survey's geofence zones.
class MapperContext {
  static String formCode = '';
  static List<dynamic> zones = const <dynamic>[];
}

// ───────────────────────────── geometry ─────────────────────────────

const double _earthR = 6371008.8;
double _rad(double d) => d * math.pi / 180;

double distM(List<num> a, List<num> b) {
  final p1 = _rad(a[1].toDouble()), p2 = _rad(b[1].toDouble());
  final dp = p2 - p1, dl = _rad((b[0] - a[0]).toDouble());
  final h = math.pow(math.sin(dp / 2), 2) +
      math.cos(p1) * math.cos(p2) * math.pow(math.sin(dl / 2), 2);
  return 2 * _earthR * math.asin(math.min(1.0, math.sqrt(h.toDouble())));
}

double pathLen(List<List<num>> c) {
  var s = 0.0;
  for (var i = 1; i < c.length; i++) {
    s += distM(c[i - 1], c[i]);
  }
  return s;
}

/// Geodesic area of a ring (same method as the server and the web runner).
double ringArea(List<List<num>> ring) {
  if (ring.length < 3) return 0;
  final r = [...ring, ring.first];
  var t = 0.0;
  for (var i = 0; i < r.length - 1; i++) {
    t += _rad((r[i + 1][0] - r[i][0]).toDouble()) *
        (2 + math.sin(_rad(r[i][1].toDouble())) + math.sin(_rad(r[i + 1][1].toDouble())));
  }
  return (t * _earthR * _earthR / 2).abs();
}

/// Ramer–Douglas–Peucker in local metres; keeps time/accuracy of kept points.
List<List<num>> simplify(List<List<num>> pts, double tol) {
  if (pts.length < 3) return List<List<num>>.from(pts);
  final lat0 = _rad(pts.first[1].toDouble());
  final kx = math.cos(lat0) * 111320, ky = 110540.0;
  final xy = pts.map((p) => [p[0] * kx, p[1] * ky]).toList();
  final keep = List<bool>.filled(pts.length, false);
  keep[0] = true;
  keep[pts.length - 1] = true;
  final stack = <List<int>>[
    [0, pts.length - 1]
  ];
  while (stack.isNotEmpty) {
    final seg = stack.removeLast();
    final a = seg[0], b = seg[1];
    var idx = -1;
    var max = 0.0;
    final x1 = xy[a][0], y1 = xy[a][1], dx = xy[b][0] - x1, dy = xy[b][1] - y1;
    final l2 = (dx * dx + dy * dy) == 0 ? 1e-9 : dx * dx + dy * dy;
    for (var i = a + 1; i < b; i++) {
      final t = (((xy[i][0] - x1) * dx + (xy[i][1] - y1) * dy) / l2).clamp(0.0, 1.0);
      final d = math.sqrt(math.pow(xy[i][0] - (x1 + t * dx), 2) + math.pow(xy[i][1] - (y1 + t * dy), 2));
      if (d > max) {
        max = d.toDouble();
        idx = i;
      }
    }
    if (max > tol && idx > 0) {
      keep[idx] = true;
      stack.add([a, idx]);
      stack.add([idx, b]);
    }
  }
  return [for (var i = 0; i < pts.length; i++) if (keep[i]) pts[i]];
}

String fmtDist(double m) => m >= 1000
    ? '${(m / 1000).toStringAsFixed(m >= 10000 ? 1 : 2)} km'
    : '${m.round()} m';

String fmtArea(double m2) => m2 >= 10000
    ? '${(m2 / 10000).toStringAsFixed(m2 >= 1e6 ? 1 : 2)} ha'
    : '${m2.round()} m²';

String fmtTime(int s) {
  final h = s ~/ 3600, m = (s % 3600) ~/ 60, x = s % 60;
  final mm = h > 0 ? m.toString().padLeft(2, '0') : '$m';
  return '${h > 0 ? '$h:' : ''}$mm:${x.toString().padLeft(2, '0')}';
}

LatLng _ll(List<num> p) => LatLng(p[1].toDouble(), p[0].toDouble());

Color _hex(String? h, [Color fallback = const Color(0xFF22D3EE)]) {
  final s = (h ?? '').replaceFirst('#', '');
  if (s.length != 6) return fallback;
  final v = int.tryParse(s, radix: 16);
  return v == null ? fallback : Color(0xFF000000 | v);
}

String _toHex(Color c) =>
    '#${(c.toARGB32() & 0xFFFFFF).toRadixString(16).padLeft(6, '0')}';

const _palette = <Color>[
  Color(0xFF22D3EE), Color(0xFFF472B6), Color(0xFFA3E635), Color(0xFFFBBF24),
  Color(0xFFF97316), Color(0xFFA78BFA), Color(0xFFEF4444), Color(0xFFFFFFFF),
];

/// Summary stats for one GeoJSON feature.
Map<String, double> featureStats(Map<String, dynamic> f) {
  final g = Map<String, dynamic>.from(f['geometry'] as Map);
  final p = Map<String, dynamic>.from((f['properties'] ?? const {}) as Map);
  final type = g['type'];
  if (type == 'LineString') {
    return {'distance': pathLen(_coords(g['coordinates']))};
  }
  if (type == 'Polygon') {
    final ring = _coords((g['coordinates'] as List).first);
    final open = ring.length > 1 ? ring.sublist(0, ring.length - 1) : ring;
    return {'area': ringArea(open), 'perimeter': pathLen(ring)};
  }
  if (p['shape'] == 'circle') {
    final r = (p['radius_m'] as num?)?.toDouble() ?? 0;
    return {'area': math.pi * r * r, 'perimeter': 2 * math.pi * r};
  }
  return {};
}

String statsText(Map<String, dynamic> f) {
  final s = featureStats(f);
  final p = Map<String, dynamic>.from((f['properties'] ?? const {}) as Map);
  final bits = <String>[];
  if (s['distance'] != null) bits.add('📏 ${fmtDist(s['distance']!)}');
  if (s['area'] != null) bits.add('⬡ ${fmtArea(s['area']!)}');
  if (p['duration_s'] is num) bits.add('⏱ ${fmtTime((p['duration_s'] as num).round())}');
  if (p['shape'] == 'point') {
    final c = (f['geometry'] as Map)['coordinates'] as List;
    bits.add('📍 ${(c[1] as num).toStringAsFixed(5)}, ${(c[0] as num).toStringAsFixed(5)}');
  }
  return bits.join(' · ');
}

List<List<num>> _coords(dynamic raw) => [
      for (final p in (raw as List? ?? const []))
        if (p is List && p.length >= 2) [for (final v in p) v as num]
    ];

// ───────────────────────────── the form field ─────────────────────────────

/// Compact card inside the form: summary + "Open map".
class MapperField extends StatelessWidget {
  const MapperField({
    super.key,
    required this.question,
    required this.value,
    required this.onChanged,
  });

  final Map<String, dynamic> question;
  final dynamic value;
  final ValueChanged<dynamic> onChanged;

  List<Map<String, dynamic>> get _features {
    final v = value;
    if (v is Map && v['features'] is List) {
      return [for (final f in v['features'] as List) Map<String, dynamic>.from(f as Map)];
    }
    return const [];
  }

  @override
  Widget build(BuildContext context) {
    final feats = _features;
    var dist = 0.0, area = 0.0;
    for (final f in feats) {
      final s = featureStats(f);
      dist += s['distance'] ?? 0;
      area += s['area'] ?? 0;
    }
    final cs = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (feats.isNotEmpty)
          Container(
            padding: const EdgeInsets.all(12),
            margin: const EdgeInsets.only(bottom: 10),
            decoration: BoxDecoration(
              color: cs.primaryContainer.withValues(alpha: .35),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${feats.length} shape${feats.length == 1 ? '' : 's'}'
                  '${dist > 0 ? ' · 📏 ${fmtDist(dist)}' : ''}'
                  '${area > 0 ? ' · ⬡ ${fmtArea(area)}' : ''}',
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 6),
                for (final f in feats.take(4))
                  Padding(
                    padding: const EdgeInsets.only(top: 3),
                    child: Row(children: [
                      Container(
                        width: 12, height: 12,
                        decoration: BoxDecoration(
                          color: _hex((f['properties'] as Map?)?['color']?.toString()),
                          borderRadius: BorderRadius.circular(3),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          '${((f['properties'] as Map?)?['label'] ?? '').toString().isEmpty ? _kindName(f) : (f['properties'] as Map)['label']} — ${statsText(f)}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ]),
                  ),
              ],
            ),
          ),
        FilledButton.icon(
          icon: const Icon(Icons.map_rounded),
          label: Text(feats.isEmpty ? 'Open map' : 'Edit on map'),
          onPressed: () async {
            final result = await Navigator.push<Map<String, dynamic>?>(
              context,
              MaterialPageRoute(
                builder: (_) => MapperPage(question: question, initial: _features),
              ),
            );
            if (result != null) {
              final list = result['features'] as List? ?? const [];
              onChanged(list.isEmpty ? null : result);
            }
          },
        ),
      ],
    );
  }

  static String _kindName(Map<String, dynamic> f) {
    final p = (f['properties'] as Map?) ?? const {};
    switch (p['kind']) {
      case 'track':
        return 'Route';
      case 'area':
        return 'Area';
      default:
        return (p['shape'] ?? 'Shape').toString();
    }
  }
}

// ───────────────────────────── the map page ─────────────────────────────

class MapperPage extends StatefulWidget {
  const MapperPage({super.key, required this.question, required this.initial});

  final Map<String, dynamic> question;
  final List<Map<String, dynamic>> initial;

  @override
  State<MapperPage> createState() => _MapperPageState();
}

class _Recording {
  _Recording({required this.kind, required this.color});
  final String kind; // track | area
  final Color color;
  final List<List<num>> pts = <List<num>>[];
  final DateTime started = DateTime.now();
  bool paused = false;
  bool closedNotified = false;
  LiveSession? live;
}

class _MapperPageState extends State<MapperPage> {
  final MapController _map = MapController();
  late final Map<String, dynamic> cfg =
      Map<String, dynamic>.from((widget.question['mapper'] ?? const {}) as Map);
  late final List<String> modes = [
    for (final m in (cfg['modes'] as List? ?? const ['track', 'area', 'draw']))
      if (const {'track', 'area', 'draw'}.contains(m)) m.toString()
  ];
  late String mode = modes.contains(cfg['default_mode']) ? cfg['default_mode'] as String : (modes.isEmpty ? 'track' : modes.first);
  late final List<Map<String, dynamic>> features = [
    for (final f in widget.initial) Map<String, dynamic>.from(f)
  ];
  late final int maxFeatures = ((cfg['max_features'] as num?) ?? 10).toInt().clamp(1, 25);
  late final double accuracyNeeded = ((cfg['accuracy_m'] as num?) ?? 30).toDouble();
  late final double stepM = ((cfg['step_m'] as num?) ?? 3).toDouble();

  Color color = _palette.first;
  String base = 'satellite';
  _Recording? rec;
  StreamSubscription<Position>? _gps;
  Position? lastFix;
  bool follow = true;
  Timer? _clock;
  DateTime _lastPersist = DateTime.fromMillisecondsSinceEpoch(0);

  // draw mode
  String tool = 'polygon'; // polygon | line | point | circle
  final List<LatLng> draft = <LatLng>[];
  double circleRadius = 50;

  String get _traceKey => '${MapperContext.formCode}:${widget.question['name']}';
  AppDatabase get _db => context.read<AppDatabase>();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _offerResume());
  }

  @override
  void dispose() {
    _gps?.cancel();
    _clock?.cancel();
    super.dispose();
  }

  // ── recording ──

  Future<bool> _ensurePermission() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      _snack('Turn on Location (GPS) in the phone settings.');
      return false;
    }
    var p = await Geolocator.checkPermission();
    if (p == LocationPermission.denied) p = await Geolocator.requestPermission();
    if (p == LocationPermission.denied || p == LocationPermission.deniedForever) {
      _snack('Location permission is needed to record on the map.');
      return false;
    }
    return true;
  }

  LocationSettings _locationSettings() {
    if (defaultTargetPlatform == TargetPlatform.android) {
      return AndroidSettings(
        accuracy: LocationAccuracy.bestForNavigation,
        distanceFilter: 0,
        intervalDuration: const Duration(seconds: 1),
        // Foreground service: keeps recording with the screen off or the
        // app in the background, with a visible notification.
        foregroundNotificationConfig: const ForegroundNotificationConfig(
          notificationTitle: 'Kura is recording your route',
          notificationText: 'GPS tracing is on. Open Kura Collect to finish.',
          enableWakeLock: true,
          setOngoing: true,
        ),
      );
    }
    return const LocationSettings(accuracy: LocationAccuracy.best, distanceFilter: 0);
  }

  Future<void> _start({Map<String, dynamic>? resumeFrom}) async {
    if (features.length >= maxFeatures && resumeFrom == null) {
      _snack('Maximum of $maxFeatures shapes for this question.');
      return;
    }
    if (!await _ensurePermission()) return;
    final kind = resumeFrom?['kind']?.toString() ?? (mode == 'area' ? 'area' : 'track');
    final r = _Recording(kind: kind, color: resumeFrom != null ? _hex(resumeFrom['color']?.toString()) : color);
    if (resumeFrom != null) r.pts.addAll(_coords(resumeFrom['pts']));
    final live = LiveStreamService.instance;
    r.live = resumeFrom != null && resumeFrom['live'] is Map
        ? live.resume(Map<String, dynamic>.from(resumeFrom['live'] as Map), MapperContext.formCode,
            widget.question['name'].toString())
        : live.start(
            formCode: MapperContext.formCode,
            question: widget.question['name'].toString(),
            kind: kind,
            color: _toHex(r.color),
            label: (widget.question['label'] ?? '').toString(),
          );
    setState(() {
      rec = r;
      mode = kind;
      follow = true;
    });
    _gps = Geolocator.getPositionStream(locationSettings: _locationSettings())
        .listen(_onFix, onError: (Object e) => _snack('GPS problem: $e'));
    _clock = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
    HapticFeedback.mediumImpact();
  }

  void _onFix(Position p) {
    lastFix = p;
    final r = rec;
    if (r == null) return;
    final pos = <num>[
      double.parse(p.longitude.toStringAsFixed(7)),
      double.parse(p.latitude.toStringAsFixed(7)),
      p.timestamp.millisecondsSinceEpoch,
      p.accuracy.round(),
    ];
    if (follow) {
      _map.move(LatLng(p.latitude, p.longitude), math.max(_map.camera.zoom, 17.0));
    }
    if (r.paused || p.accuracy > accuracyNeeded) {
      setState(() {});
      return;
    }
    if (r.pts.isNotEmpty) {
      final last = r.pts.last;
      final d = distM(last, pos);
      final dt = math.max(1, (pos[2] - last[2]) / 1000);
      if (d / dt * 3.6 > 250) return; // GPS spike
      if (d < math.max(stepM, p.accuracy * 0.4)) {
        setState(() {});
        return; // jitter while standing still
      }
    }
    r.pts.add(pos);
    if (r.live != null) LiveStreamService.instance.addPoint(r.live!, pos);
    _persist();

    if (r.kind == 'area' && !r.closedNotified && r.pts.length > 8) {
      final walked = pathLen(r.pts);
      final back = distM(r.pts.first, pos);
      if (walked > 40 && back < math.max(12, p.accuracy)) {
        r.closedNotified = true;
        HapticFeedback.heavyImpact();
        _snack('🎯 You are back at the start — tap Finish to close the area.');
      }
    }
    setState(() {});
  }

  void _persist({bool force = false}) {
    final r = rec;
    if (r == null) return;
    final now = DateTime.now();
    if (!force && now.difference(_lastPersist).inSeconds < 4) return;
    _lastPersist = now;
    _db.saveTrace(_traceKey, MapperContext.formCode, widget.question['name'].toString(), {
      'kind': r.kind,
      'color': _toHex(r.color),
      'pts': r.pts,
      'live': r.live == null
          ? null
          : {'id': r.live!.id, 'seq': r.live!.seq, 'kind': r.kind, 'color': _toHex(r.color)},
    });
  }

  Future<void> _offerResume() async {
    final saved = await _db.loadTrace(_traceKey);
    if (saved == null || !mounted) return;
    final pts = _coords(saved['pts']);
    if (pts.isEmpty) {
      await _db.clearTrace(_traceKey);
      return;
    }
    final resume = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Unfinished recording'),
        content: Text('A ${saved['kind'] == 'area' ? 'walked area' : 'route'} with '
            '${pts.length} points (${fmtDist(pathLen(pts))}) was not finished. Continue it?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Discard')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Continue')),
        ],
      ),
    );
    if (resume == true) {
      await _start(resumeFrom: saved);
    } else {
      await _db.clearTrace(_traceKey);
    }
  }

  void _pause() {
    final r = rec;
    if (r == null) return;
    setState(() => r.paused = !r.paused);
    if (r.live != null) {
      LiveStreamService.instance.setStatus(r.live!, r.paused ? 'paused' : 'recording');
    }
  }

  Future<void> _finish() async {
    final r = rec;
    if (r == null) return;
    final need = r.kind == 'area' ? 3 : 2;
    if (r.pts.length < need) {
      final drop = await _confirm('Not enough points',
          'Only ${r.pts.length} GPS point(s) were recorded. Discard this recording?');
      if (drop == true) await _stop(discard: true);
      return;
    }
    final pts = simplify(r.pts, 1.5);
    final props = <String, dynamic>{'kind': r.kind, 'color': _toHex(r.color)};
    Map<String, dynamic> f;
    if (r.kind == 'area') {
      final ring = [for (final p in pts) <num>[p[0], p[1]]];
      ring.add(ring.first);
      props['shape'] = 'polygon';
      props['duration_s'] = ((r.pts.last[2] - r.pts.first[2]) / 1000).round();
      f = {
        'type': 'Feature',
        'geometry': {'type': 'Polygon', 'coordinates': [ring]},
        'properties': props,
      };
    } else {
      props['shape'] = 'line';
      // Keep [lng, lat, t, accuracy] so the server can compute time and speed.
      f = {
        'type': 'Feature',
        'geometry': {'type': 'LineString', 'coordinates': pts},
        'properties': props,
      };
    }
    features.add(f);
    await _stop(discard: false);
    HapticFeedback.mediumImpact();
    _snack('✔ Saved · ${statsText(f)}');
  }

  Future<void> _stop({required bool discard}) async {
    final r = rec;
    await _gps?.cancel();
    _gps = null;
    _clock?.cancel();
    if (r?.live != null) {
      await LiveStreamService.instance.setStatus(r!.live!, discard ? 'discarded' : 'finished');
    }
    await _db.clearTrace(_traceKey);
    if (mounted) setState(() => rec = null);
  }

  // ── drawing ──

  void _onTap(TapPosition _, LatLng at) {
    if (rec != null || mode != 'draw') return;
    if (features.length >= maxFeatures) {
      _snack('Maximum of $maxFeatures shapes.');
      return;
    }
    setState(() {
      if (tool == 'point') {
        _addFeature({
          'type': 'Point',
          'coordinates': [_r7(at.longitude), _r7(at.latitude)]
        }, {'shape': 'point'});
      } else if (tool == 'circle') {
        draft
          ..clear()
          ..add(at);
      } else {
        draft.add(at);
      }
    });
  }

  double _r7(double v) => double.parse(v.toStringAsFixed(7));

  void _closeDraft() {
    if (tool == 'circle') {
      if (draft.isEmpty) return;
      _addFeature({
        'type': 'Point',
        'coordinates': [_r7(draft.first.longitude), _r7(draft.first.latitude)]
      }, {'shape': 'circle', 'radius_m': circleRadius.roundToDouble()});
    } else if (tool == 'line') {
      if (draft.length < 2) return _snack('Tap at least 2 points for a line.');
      _addFeature({
        'type': 'LineString',
        'coordinates': [for (final p in draft) [_r7(p.longitude), _r7(p.latitude)]]
      }, {'shape': 'line'});
    } else {
      if (draft.length < 3) return _snack('Tap at least 3 corners for an area.');
      final ring = [for (final p in draft) [_r7(p.longitude), _r7(p.latitude)]];
      ring.add(ring.first);
      _addFeature({'type': 'Polygon', 'coordinates': [ring]}, {'shape': 'polygon'});
    }
    setState(draft.clear);
  }

  void _addFeature(Map<String, dynamic> geometry, Map<String, dynamic> props) {
    final f = {
      'type': 'Feature',
      'geometry': geometry,
      'properties': {'kind': 'drawn', 'color': _toHex(color), ...props},
    };
    features.add(f);
    HapticFeedback.selectionClick();
    _snack('Added · ${statsText(f)}');
  }

  // ── helpers ──

  void _snack(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(msg), duration: const Duration(seconds: 3)));
  }

  Future<bool?> _confirm(String title, String body) => showDialog<bool>(
        context: context,
        builder: (_) => AlertDialog(
          title: Text(title),
          content: Text(body),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('No')),
            FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Yes')),
          ],
        ),
      );

  Map<String, dynamic> _result() => {'type': 'FeatureCollection', 'features': features};

  String get _tileUrl {
    const root = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
    switch (base) {
      case 'streets':
        return '${root}World_Street_Map/MapServer/tile/{z}/{y}/{x}';
      case 'terrain':
        return '${root}World_Topo_Map/MapServer/tile/{z}/{y}/{x}';
      default:
        return '${root}World_Imagery/MapServer/tile/{z}/{y}/{x}';
    }
  }

  LatLng get _initialCenter {
    for (final f in features) {
      final c = _coords(_firstCoords(f));
      if (c.isNotEmpty) return _ll(c.first);
    }
    return const LatLng(13.45, -16.58);
  }

  dynamic _firstCoords(Map<String, dynamic> f) {
    final g = f['geometry'] as Map;
    if (g['type'] == 'Point') return [g['coordinates']];
    if (g['type'] == 'Polygon') return (g['coordinates'] as List).first;
    return g['coordinates'];
  }

  // ── build ──

  @override
  Widget build(BuildContext context) {
    final r = rec;
    return PopScope(
      canPop: r == null,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        final finish = await _confirm('Recording in progress',
            'Finish and save this recording before leaving?');
        if (finish == true) {
          await _finish();
          if (mounted) Navigator.pop(context, _result());
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text((widget.question['label'] ?? 'Map').toString(),
              maxLines: 1, overflow: TextOverflow.ellipsis),
          actions: [
            IconButton(
              tooltip: 'Map style',
              icon: const Icon(Icons.layers_rounded),
              onPressed: () => setState(() => base = base == 'satellite'
                  ? 'streets'
                  : base == 'streets'
                      ? 'terrain'
                      : 'satellite'),
            ),
            if (r == null)
              TextButton(
                onPressed: () => Navigator.pop(context, _result()),
                child: const Text('Done', style: TextStyle(fontWeight: FontWeight.w800)),
              ),
          ],
        ),
        body: Column(
          children: [
            if (modes.length > 1)
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
                child: SegmentedButton<String>(
                  segments: [
                    if (modes.contains('track'))
                      const ButtonSegment(value: 'track', icon: Icon(Icons.directions_walk_rounded), label: Text('Trace')),
                    if (modes.contains('area'))
                      const ButtonSegment(value: 'area', icon: Icon(Icons.hexagon_outlined), label: Text('Walk area')),
                    if (modes.contains('draw'))
                      const ButtonSegment(value: 'draw', icon: Icon(Icons.draw_rounded), label: Text('Draw')),
                  ],
                  selected: {mode},
                  onSelectionChanged: r != null
                      ? null
                      : (s) => setState(() {
                            mode = s.first;
                            draft.clear();
                          }),
                ),
              ),
            Expanded(child: _mapStack(r)),
            _controls(r),
          ],
        ),
      ),
    );
  }

  Widget _mapStack(_Recording? r) {
    final zones = MapperContext.zones;
    final polys = <Polygon>[];
    final lines = <Polyline>[];
    final circles = <CircleMarker>[];
    final markers = <Marker>[];

    for (final z in zones) {
      if (z is! Map) continue;
      final c = _hex(z['color']?.toString());
      if (z['kind'] == 'polygon' && z['points'] is List && (z['points'] as List).length >= 3) {
        polys.add(Polygon(
          points: [for (final p in z['points'] as List) LatLng((p[0] as num).toDouble(), (p[1] as num).toDouble())],
          color: c.withValues(alpha: .08),
          borderColor: c,
          borderStrokeWidth: 2,
        ));
      } else if (z['lat'] is num && z['lng'] is num) {
        circles.add(CircleMarker(
          point: LatLng((z['lat'] as num).toDouble(), (z['lng'] as num).toDouble()),
          radius: (((z['radius_km'] as num?) ?? 1) * 1000).toDouble(),
          useRadiusInMeter: true,
          color: c.withValues(alpha: .08),
          borderColor: c,
          borderStrokeWidth: 2,
        ));
      }
    }

    for (final f in features) {
      final g = f['geometry'] as Map;
      final p = (f['properties'] as Map?) ?? const {};
      final c = _hex(p['color']?.toString());
      final type = g['type'];
      if (type == 'LineString') {
        lines.add(Polyline(points: [for (final x in _coords(g['coordinates'])) _ll(x)], color: c, strokeWidth: 5));
      } else if (type == 'Polygon') {
        polys.add(Polygon(
          points: [for (final x in _coords((g['coordinates'] as List).first)) _ll(x)],
          color: c.withValues(alpha: .25),
          borderColor: c,
          borderStrokeWidth: 3,
        ));
      } else if (p['shape'] == 'circle') {
        circles.add(CircleMarker(
          point: _ll(_coords([g['coordinates']]).first),
          radius: ((p['radius_m'] as num?) ?? 10).toDouble(),
          useRadiusInMeter: true,
          color: c.withValues(alpha: .25),
          borderColor: c,
          borderStrokeWidth: 3,
        ));
      } else {
        markers.add(Marker(
          point: _ll(_coords([g['coordinates']]).first),
          width: 34,
          height: 34,
          child: Icon(Icons.location_on_rounded, color: c, size: 34),
        ));
      }
    }

    if (r != null && r.pts.isNotEmpty) {
      final ll = [for (final x in r.pts) _ll(x)];
      if (r.kind == 'area' && ll.length >= 3) {
        polys.add(Polygon(points: ll, color: r.color.withValues(alpha: .18), borderColor: r.color, borderStrokeWidth: 0));
        lines.add(Polyline(points: [ll.last, ll.first], color: r.color.withValues(alpha: .6), strokeWidth: 2));
      }
      lines.add(Polyline(points: ll, color: r.color, strokeWidth: 6));
    }

    if (mode == 'draw' && draft.isNotEmpty) {
      if (tool == 'circle') {
        circles.add(CircleMarker(
          point: draft.first,
          radius: circleRadius,
          useRadiusInMeter: true,
          color: color.withValues(alpha: .25),
          borderColor: color,
          borderStrokeWidth: 3,
        ));
      } else {
        lines.add(Polyline(points: tool == 'polygon' && draft.length > 2 ? [...draft, draft.first] : draft, color: color, strokeWidth: 3));
      }
      for (final d in draft) {
        markers.add(Marker(
          point: d,
          width: 16,
          height: 16,
          child: Container(decoration: BoxDecoration(color: color, shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 2))),
        ));
      }
    }

    final fix = lastFix;
    if (fix != null) {
      final me = LatLng(fix.latitude, fix.longitude);
      circles.add(CircleMarker(point: me, radius: fix.accuracy, useRadiusInMeter: true,
          color: Colors.lightBlue.withValues(alpha: .15), borderColor: Colors.lightBlue, borderStrokeWidth: 1));
      markers.add(Marker(
        point: me,
        width: 22,
        height: 22,
        child: Container(decoration: BoxDecoration(color: Colors.lightBlue, shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 3))),
      ));
    }

    return Stack(
      children: [
        FlutterMap(
          mapController: _map,
          options: MapOptions(
            initialCenter: _initialCenter,
            initialZoom: features.isEmpty ? 9 : 16,
            maxZoom: 21,
            onTap: _onTap,
            onPositionChanged: (_, hasGesture) {
              if (hasGesture && rec != null && follow) setState(() => follow = false);
            },
          ),
          children: [
            TileLayer(
              urlTemplate: _tileUrl,
              maxNativeZoom: 19,
              maxZoom: 21,
              userAgentPackageName: 'app.nokknock.kura_collect',
            ),
            PolygonLayer(polygons: polys),
            PolylineLayer(polylines: lines),
            CircleLayer(circles: circles),
            MarkerLayer(markers: markers),
          ],
        ),
        Positioned(
          right: 10,
          top: 10,
          child: Column(children: [
            _roundBtn(Icons.my_location_rounded, 'My location', _locateMe),
            if (r != null) ...[
              const SizedBox(height: 8),
              _roundBtn(follow ? Icons.navigation_rounded : Icons.navigation_outlined, 'Follow me',
                  () => setState(() => follow = !follow), active: follow),
            ],
          ]),
        ),
        if (r != null) Positioned(left: 10, right: 10, bottom: 10, child: _hud(r)),
        ValueListenableBuilder<String>(
          valueListenable: LiveStreamService.instance.state,
          builder: (_, live, __) => r == null || live == 'off'
              ? const SizedBox.shrink()
              : Positioned(
                  left: 10,
                  top: 10,
                  child: Chip(
                    avatar: Icon(live == 'live' ? Icons.sensors_rounded : Icons.cloud_off_rounded,
                        size: 18, color: live == 'live' ? Colors.red : Colors.orange),
                    label: Text(live == 'live' ? 'LIVE to supervisor' : 'Offline — queued'),
                  ),
                ),
        ),
      ],
    );
  }

  Future<void> _locateMe() async {
    if (!await _ensurePermission()) return;
    try {
      final p = await Geolocator.getCurrentPosition();
      setState(() => lastFix = p);
      _map.move(LatLng(p.latitude, p.longitude), 17);
    } catch (_) {
      _snack('Could not get a GPS fix. Try again outdoors.');
    }
  }

  Widget _roundBtn(IconData icon, String tip, VoidCallback onTap, {bool active = false}) => Material(
        color: active ? Theme.of(context).colorScheme.primary : Colors.black.withValues(alpha: .65),
        shape: const CircleBorder(),
        child: IconButton(tooltip: tip, icon: Icon(icon, color: Colors.white), onPressed: onTap),
      );

  Widget _hud(_Recording r) {
    final secs = DateTime.now().difference(r.started).inSeconds;
    final d = pathLen(r.pts);
    final acc = lastFix?.accuracy;
    final weak = acc != null && acc > accuracyNeeded;
    final recent = r.pts.where((p) => p[2] > DateTime.now().millisecondsSinceEpoch - 20000).toList();
    var speed = 0.0;
    if (recent.length >= 2) {
      final dt = (recent.last[2] - recent.first[2]) / 1000;
      if (dt > 0) speed = pathLen(recent) / dt * 3.6;
    }
    Widget cell(String v, String l) => Expanded(
          child: Column(children: [
            Text(v, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w900)),
            Text(l, style: const TextStyle(color: Colors.white70, fontSize: 10.5, letterSpacing: .8)),
          ]),
        );
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 6),
      decoration: BoxDecoration(color: Colors.black.withValues(alpha: .78), borderRadius: BorderRadius.circular(16)),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Row(children: [
          cell(fmtDist(d), 'DISTANCE'),
          if (r.kind == 'area') cell(r.pts.length >= 3 ? fmtArea(ringArea(r.pts)) : '—', 'AREA'),
          cell(fmtTime(secs), 'TIME'),
          cell(speed < 1 ? '0' : speed.toStringAsFixed(speed < 10 ? 1 : 0), 'KM/H'),
        ]),
        const SizedBox(height: 6),
        Text(
          r.paused
              ? '⏸ Paused — nothing is recorded'
              : acc == null
                  ? 'Waiting for GPS…'
                  : weak
                      ? '⚠ Weak GPS ±${acc.round()} m — move to open sky'
                      : 'GPS ±${acc.round()} m · ${r.pts.length} points',
          style: TextStyle(color: weak ? Colors.orangeAccent : Colors.lightGreenAccent, fontWeight: FontWeight.w700, fontSize: 12.5),
        ),
      ]),
    );
  }

  Widget _controls(_Recording? r) {
    final cs = Theme.of(context).colorScheme;
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
        decoration: BoxDecoration(color: cs.surface, boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: .12), blurRadius: 12)]),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          if (r != null)
            Row(children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _pause,
                  icon: Icon(r.paused ? Icons.play_arrow_rounded : Icons.pause_rounded),
                  label: Text(r.paused ? 'Resume' : 'Pause'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                flex: 2,
                child: FilledButton.icon(
                  style: FilledButton.styleFrom(backgroundColor: Colors.green.shade600, padding: const EdgeInsets.symmetric(vertical: 14)),
                  onPressed: _finish,
                  icon: const Icon(Icons.check_rounded),
                  label: const Text('Finish', style: TextStyle(fontWeight: FontWeight.w800)),
                ),
              ),
              const SizedBox(width: 8),
              IconButton.outlined(
                tooltip: 'Discard',
                onPressed: () async {
                  if (await _confirm('Discard recording?', 'The points recorded so far will be deleted.') == true) {
                    await _stop(discard: true);
                  }
                },
                icon: const Icon(Icons.delete_outline_rounded),
              ),
            ])
          else if (mode == 'draw')
            _drawControls()
          else
            FilledButton.icon(
              style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
              onPressed: features.length >= maxFeatures ? null : () => _start(),
              icon: Icon(mode == 'area' ? Icons.hexagon_outlined : Icons.play_arrow_rounded),
              label: Text(mode == 'area' ? 'Start walking the boundary' : 'Start tracing',
                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            ),
          const SizedBox(height: 8),
          SizedBox(
            height: 34,
            child: ListView(scrollDirection: Axis.horizontal, children: [
              for (final c in _palette)
                GestureDetector(
                  onTap: () => setState(() => color = c),
                  child: Container(
                    width: 30,
                    height: 30,
                    margin: const EdgeInsets.only(right: 8),
                    decoration: BoxDecoration(
                      color: c,
                      shape: BoxShape.circle,
                      border: Border.all(color: c == color ? cs.onSurface : Colors.black26, width: c == color ? 3 : 1),
                    ),
                  ),
                ),
            ]),
          ),
          if (features.isNotEmpty) ...[
            const SizedBox(height: 6),
            ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 150),
              child: ListView.builder(
                shrinkWrap: true,
                itemCount: features.length,
                itemBuilder: (_, i) => _featureTile(i),
              ),
            ),
          ],
        ]),
      ),
    );
  }

  Widget _drawControls() {
    final tools = <String, (IconData, String)>{
      'polygon': (Icons.pentagon_outlined, 'Area'),
      'line': (Icons.timeline_rounded, 'Line'),
      'point': (Icons.place_rounded, 'Pin'),
      'circle': (Icons.circle_outlined, 'Circle'),
    };
    return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Wrap(spacing: 8, children: [
        for (final e in tools.entries)
          ChoiceChip(
            avatar: Icon(e.value.$1, size: 18),
            label: Text(e.value.$2),
            selected: tool == e.key,
            onSelected: (_) => setState(() {
              tool = e.key;
              draft.clear();
            }),
          ),
      ]),
      const SizedBox(height: 6),
      Text(
        tool == 'point'
            ? 'Tap the map to drop a pin.'
            : tool == 'circle'
                ? (draft.isEmpty ? 'Tap the map to place the centre.' : 'Radius ${circleRadius.round()} m')
                : 'Tap the map to add ${tool == 'line' ? 'points' : 'corners'} (${draft.length} so far).',
        style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
      ),
      if (tool == 'circle' && draft.isNotEmpty)
        Slider(min: 5, max: 2000, value: circleRadius, onChanged: (v) => setState(() => circleRadius = v)),
      if (tool != 'point' && draft.isNotEmpty)
        Row(children: [
          TextButton.icon(
            onPressed: () => setState(() => draft.isEmpty ? null : draft.removeLast()),
            icon: const Icon(Icons.undo_rounded),
            label: const Text('Undo'),
          ),
          TextButton(onPressed: () => setState(draft.clear), child: const Text('Cancel')),
          const Spacer(),
          FilledButton.icon(onPressed: _closeDraft, icon: const Icon(Icons.check_rounded), label: const Text('Add shape')),
        ]),
    ]);
  }

  Widget _featureTile(int i) {
    final f = features[i];
    final p = Map<String, dynamic>.from((f['properties'] ?? const {}) as Map);
    final c = _hex(p['color']?.toString());
    return ListTile(
      dense: true,
      contentPadding: EdgeInsets.zero,
      leading: GestureDetector(
        onTap: () => setState(() {
          (f['properties'] as Map)['color'] = _toHex(color);
        }),
        child: CircleAvatar(radius: 12, backgroundColor: c),
      ),
      title: TextFormField(
        initialValue: (p['label'] ?? '').toString(),
        decoration: InputDecoration(
          isDense: true,
          border: InputBorder.none,
          filled: false,
          hintText: '${MapperField._kindName(f)} ${i + 1} — add a name',
        ),
        onChanged: (v) => (f['properties'] as Map)['label'] = v.length > 80 ? v.substring(0, 80) : v,
      ),
      subtitle: Text(statsText(f)),
      trailing: IconButton(
        icon: const Icon(Icons.delete_outline_rounded),
        onPressed: () async {
          if (await _confirm('Delete shape?', 'Remove this shape from the answer?') == true) {
            setState(() => features.removeAt(i));
          }
        },
      ),
    );
  }
}
