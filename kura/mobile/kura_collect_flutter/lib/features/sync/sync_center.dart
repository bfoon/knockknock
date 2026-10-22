import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/models/submission_model.dart';
import '../../core/services/live_stream_service.dart';
import '../../core/services/sync_engine.dart';
import '../submissions/submissions_controller.dart';

String _ago(DateTime? t) {
  if (t == null) return 'never';
  final d = DateTime.now().difference(t.toLocal());
  if (d.inSeconds < 45) return 'just now';
  if (d.inMinutes < 60) return '${d.inMinutes} min ago';
  if (d.inHours < 24) return '${d.inHours} h ago';
  return '${d.inDays} d ago';
}

String _inFuture(DateTime? t) {
  if (t == null) return '';
  final d = t.toLocal().difference(DateTime.now());
  if (d.inSeconds <= 30) return 'any moment';
  if (d.inMinutes < 60) return 'in ${d.inMinutes + 1} min';
  return 'in ${d.inHours} h';
}

class _Look {
  const _Look(this.icon, this.color, this.text);
  final IconData icon;
  final Color color;
  final String text;
}

_Look _lookOf(SyncEngine e, ColorScheme cs) {
  switch (e.phase) {
    case SyncPhase.syncing:
      return _Look(Icons.sync_rounded, cs.primary,
          e.progressTotal > 0 ? 'Sending ${e.progressDone}/${e.progressTotal}…' : 'Syncing…');
    case SyncPhase.offline:
      return _Look(Icons.cloud_off_rounded, Colors.blueGrey,
          e.waiting > 0 ? 'Offline · ${e.waiting} safe on this phone' : 'Offline · nothing waiting');
    case SyncPhase.waitingWifi:
      return _Look(Icons.wifi_rounded, Colors.orange, 'Waiting for Wi-Fi · ${e.waiting} to send');
    case SyncPhase.paused:
      return _Look(Icons.pause_circle_outline_rounded, Colors.orange,
          e.message ?? 'Sync paused');
    case SyncPhase.attention:
      return _Look(Icons.error_outline_rounded, cs.error,
          '${e.rejected} need${e.rejected == 1 ? 's' : ''} attention · tap to fix');
    case SyncPhase.idle:
      if (e.waiting > 0) {
        return _Look(Icons.cloud_upload_outlined, cs.primary,
            '${e.waiting} waiting · retry ${_inFuture(e.nextRetry).isEmpty ? 'soon' : _inFuture(e.nextRetry)}');
      }
      return _Look(Icons.cloud_done_rounded, Colors.green.shade600,
          'All synced · ${_ago(e.lastSuccess)}');
  }
}

/// Slim, always-visible sync status. Tap → Sync Center.
class SyncStatusBar extends StatelessWidget {
  const SyncStatusBar({super.key});

  @override
  Widget build(BuildContext context) {
    final e = context.watch<SyncEngine>();
    final cs = Theme.of(context).colorScheme;
    final look = _lookOf(e, cs);
    final progress = e.phase == SyncPhase.syncing && e.progressTotal > 0
        ? e.progressDone / e.progressTotal
        : null;
    return Material(
      color: look.color.withValues(alpha: .12),
      child: InkWell(
        onTap: () => SyncCenterSheet.show(context),
        child: SafeArea(
          bottom: false,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 7, 10, 7),
                child: Row(
                  children: [
                    _SpinIcon(icon: look.icon, color: look.color, spin: e.phase == SyncPhase.syncing),
                    const SizedBox(width: 10),
                    Expanded(
                      child: AnimatedSwitcher(
                        duration: const Duration(milliseconds: 250),
                        child: Text(
                          look.text,
                          key: ValueKey(look.text),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontWeight: FontWeight.w700, color: look.color),
                        ),
                      ),
                    ),
                    ValueListenableBuilder<String>(
                      valueListenable: LiveStreamService.instance.state,
                      builder: (_, live, __) => live == 'off'
                          ? const SizedBox.shrink()
                          : Padding(
                              padding: const EdgeInsets.only(right: 6),
                              child: Chip(
                                visualDensity: VisualDensity.compact,
                                avatar: Icon(live == 'live' ? Icons.sensors_rounded : Icons.schedule_rounded,
                                    size: 16, color: live == 'live' ? Colors.red : Colors.orange),
                                label: Text(live == 'live' ? 'LIVE' : 'GPS queued'),
                              ),
                            ),
                    ),
                    Icon(Icons.chevron_right_rounded, color: look.color),
                  ],
                ),
              ),
              if (progress != null)
                LinearProgressIndicator(value: progress, minHeight: 2, color: look.color),
            ],
          ),
        ),
      ),
    );
  }
}

class _SpinIcon extends StatefulWidget {
  const _SpinIcon({required this.icon, required this.color, required this.spin});
  final IconData icon;
  final Color color;
  final bool spin;

  @override
  State<_SpinIcon> createState() => _SpinIconState();
}

class _SpinIconState extends State<_SpinIcon> with SingleTickerProviderStateMixin {
  late final AnimationController _c =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 1100));

  @override
  void didUpdateWidget(covariant _SpinIcon oldWidget) {
    super.didUpdateWidget(oldWidget);
    widget.spin ? _c.repeat() : _c.stop();
  }

  @override
  void initState() {
    super.initState();
    if (widget.spin) _c.repeat();
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => RotationTransition(
        turns: _c,
        child: Icon(widget.icon, size: 20, color: widget.color),
      );
}

/// Full sync control: Sync now, status, problems, settings.
class SyncCenterSheet extends StatelessWidget {
  const SyncCenterSheet({super.key});

  static Future<void> show(BuildContext context) => showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        showDragHandle: true,
        builder: (_) => const SyncCenterSheet(),
      );

  @override
  Widget build(BuildContext context) {
    final e = context.watch<SyncEngine>();
    final records = context.watch<SubmissionsController>();
    final cs = Theme.of(context).colorScheme;
    final look = _lookOf(e, cs);
    final attention = records.submissions.where((s) => s.needsAttention).toList();
    final waiting = records.submissions.where((s) => s.isWaiting && !s.isDraft).toList();

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: .78,
      maxChildSize: .95,
      builder: (context, scroll) => ListView(
        controller: scroll,
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 28),
        children: [
          Center(child: _SyncButton(engine: e, color: look.color)),
          const SizedBox(height: 14),
          Text(look.text,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w800, color: look.color)),
          if (e.message != null && e.message != look.text) ...[
            const SizedBox(height: 4),
            Text(e.message!, textAlign: TextAlign.center, style: TextStyle(color: cs.onSurfaceVariant)),
          ],
          const SizedBox(height: 6),
          Text(
            'Last sync ${_ago(e.lastSuccess)}'
            '${e.nextRetry != null && e.waiting > 0 ? ' · next try ${_inFuture(e.nextRetry)}' : ''}'
            '${e.online ? (e.onWifi ? ' · Wi-Fi' : ' · mobile data') : ' · offline'}',
            textAlign: TextAlign.center,
            style: TextStyle(color: cs.onSurfaceVariant, fontSize: 12.5),
          ),
          const SizedBox(height: 18),
          Row(children: [
            _Stat(label: 'Waiting', value: e.waiting, color: cs.primary, icon: Icons.cloud_upload_outlined),
            const SizedBox(width: 10),
            _Stat(label: 'Need attention', value: e.rejected, color: cs.error, icon: Icons.error_outline_rounded),
            const SizedBox(width: 10),
            _Stat(label: 'Sent', value: e.synced, color: Colors.green.shade600, icon: Icons.cloud_done_rounded),
          ]),
          const SizedBox(height: 14),
          ValueListenableBuilder<int>(
            valueListenable: LiveStreamService.instance.queued,
            builder: (_, q, __) => q == 0
                ? const SizedBox.shrink()
                : Card(
                    color: Colors.orange.withValues(alpha: .1),
                    child: ListTile(
                      leading: const Icon(Icons.route_rounded, color: Colors.orange),
                      title: Text('$q live GPS update${q == 1 ? '' : 's'} queued'),
                      subtitle: const Text('Sent to the live map as soon as the signal is back.'),
                    ),
                  ),
          ),
          if (attention.isNotEmpty) ...[
            const SizedBox(height: 10),
            Row(children: [
              Expanded(child: Text('Needs attention', style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800))),
              TextButton.icon(
                onPressed: e.busy ? null : () => e.retry(),
                icon: const Icon(Icons.replay_rounded),
                label: const Text('Retry all'),
              ),
            ]),
            ...attention.map((s) => _ProblemTile(item: s)),
          ],
          if (waiting.isNotEmpty && attention.isEmpty) ...[
            const SizedBox(height: 10),
            Text('Waiting to send', style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800)),
            const SizedBox(height: 6),
            ...waiting.take(5).map((s) => ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.schedule_rounded),
                  title: Text(s.formCode, style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text(s.error ?? 'Queued'),
                )),
          ],
          const SizedBox(height: 18),
          Text('Sync settings', style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            secondary: const Icon(Icons.autorenew_rounded),
            title: const Text('Auto-sync'),
            subtitle: const Text('Send finished records whenever the phone is online'),
            value: e.settings.autoSync,
            onChanged: (v) => e.updateSettings((s) => s.autoSync = v),
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            secondary: const Icon(Icons.wifi_rounded),
            title: const Text('Wi-Fi only'),
            subtitle: const Text('Save mobile data — automatic sync waits for Wi-Fi'),
            value: e.settings.wifiOnly,
            onChanged: e.settings.autoSync ? (v) => e.updateSettings((s) => s.wifiOnly = v) : null,
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            secondary: const Icon(Icons.sensors_rounded),
            title: const Text('Live GPS streaming'),
            subtitle: const Text('Supervisors see map traces grow live while you record'),
            value: e.settings.liveStream,
            onChanged: (v) => e.updateSettings((s) => s.liveStream = v),
          ),
        ],
      ),
    );
  }
}

class _SyncButton extends StatelessWidget {
  const _SyncButton({required this.engine, required this.color});
  final SyncEngine engine;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final busy = engine.busy;
    final p = engine.progressTotal > 0 ? engine.progressDone / engine.progressTotal : null;
    return SizedBox(
      width: 132,
      height: 132,
      child: Stack(
        alignment: Alignment.center,
        children: [
          SizedBox.expand(
            child: CircularProgressIndicator(
              value: busy ? p : 1,
              strokeWidth: 6,
              color: color,
              backgroundColor: color.withValues(alpha: .15),
            ),
          ),
          Material(
            color: color,
            shape: const CircleBorder(),
            elevation: 4,
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: busy
                  ? null
                  : () async {
                      final messenger = ScaffoldMessenger.maybeOf(context);
                      final r = await engine.syncNow();
                      if (r == null || messenger == null) return;
                      messenger.showSnackBar(SnackBar(
                        content: Text(r.offline && r.synced == 0
                            ? 'No connection — your records are safe and will send automatically.'
                            : r.attempted == 0
                                ? 'Everything is already synced.'
                                : '${r.synced} sent'
                                    '${r.rejected > 0 ? ' · ${r.rejected} need attention' : ''}'
                                    '${r.retrying > 0 ? ' · ${r.retrying} will retry' : ''}'),
                      ));
                    },
              child: SizedBox(
                width: 108,
                height: 108,
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(busy ? Icons.sync_rounded : Icons.cloud_sync_rounded, color: Colors.white, size: 34),
                    const SizedBox(height: 4),
                    Text(busy ? (p == null ? '…' : '${(p * 100).round()}%') : 'Sync now',
                        style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value, required this.color, required this.icon});
  final String label;
  final int value;
  final Color color;
  final IconData icon;

  @override
  Widget build(BuildContext context) => Expanded(
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
          decoration: BoxDecoration(
            color: color.withValues(alpha: .1),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Column(children: [
            Icon(icon, color: color, size: 20),
            const SizedBox(height: 4),
            Text('$value', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: color)),
            Text(label, textAlign: TextAlign.center, style: const TextStyle(fontSize: 11.5)),
          ]),
        ),
      );
}

class _ProblemTile extends StatelessWidget {
  const _ProblemTile({required this.item});
  final LocalSubmission item;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Card(
      color: cs.errorContainer.withValues(alpha: .35),
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: Icon(Icons.error_outline_rounded, color: cs.error),
        title: Text(item.formCode, style: const TextStyle(fontWeight: FontWeight.w800)),
        subtitle: Text(item.error ?? 'The server rejected this record.'),
        trailing: IconButton(
          tooltip: 'Retry',
          icon: const Icon(Icons.replay_rounded),
          onPressed: () => context.read<SubmissionsController>().retry(item.uuid),
        ),
      ),
    );
  }
}
