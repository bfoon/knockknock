import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'add_form_screen.dart';
import 'form_runner_screen.dart';
import 'forms_controller.dart';

class FormsScreen extends StatefulWidget {
  const FormsScreen({super.key});

  @override
  State<FormsScreen> createState() => _FormsScreenState();
}

class _FormsScreenState extends State<FormsScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() async {
      final controller = context.read<FormsController>();
      await controller.loadLocal();
      await controller.refresh();
    });
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<FormsController>();
    return Scaffold(
      appBar: AppBar(
        title: const Text('Forms'),
        actions: [
          IconButton(
            onPressed: controller.loading ? null : controller.refresh,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => const AddFormScreen()),
        ),
        icon: const Icon(Icons.add_rounded),
        label: const Text('Add form'),
      ),
      body: controller.forms.isEmpty
          ? const Center(
              child: Padding(
                padding: EdgeInsets.all(32),
                child: Text(
                  'No forms are stored on this device. Scan a QR code or enter a form code.',
                  textAlign: TextAlign.center,
                ),
              ),
            )
          : Column(children: [
              if (controller.approvedNotice != null)
                _Notice(
                  color: Colors.green,
                  icon: Icons.verified_rounded,
                  text: controller.approvedNotice!,
                  onClose: controller.clearApprovedNotice,
                )
              else if (controller.pendingApproval > 0)
                _Notice(
                  color: Colors.orange,
                  icon: Icons.hourglass_top_rounded,
                  text: '${controller.pendingApproval} form${controller.pendingApproval == 1 ? ' is' : 's are'} '
                      'waiting for your supervisor to approve this phone in Kura → Live monitor. '
                      'This screen checks every minute and downloads it automatically.',
                ),
              Expanded(child: RefreshIndicator(
              onRefresh: controller.refresh,
              child: ListView.separated(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
                itemCount: controller.forms.length,
                separatorBuilder: (_, __) => const SizedBox(height: 12),
                itemBuilder: (context, index) {
                  final form = controller.forms[index];
                  final ready = form.allowed && form.schema != null;
                  final needsDownload = form.allowed && form.schema == null;
                  return Card(
                    child: ListTile(
                      contentPadding: const EdgeInsets.all(16),
                      leading: CircleAvatar(
                        child: Icon(ready
                            ? Icons.assignment_turned_in_rounded
                            : needsDownload
                                ? Icons.download_rounded
                                : form.accessStatus == 'pending'
                                    ? Icons.hourglass_top_rounded
                                    : Icons.block_rounded),
                      ),
                      title: Text(form.title,
                          style: const TextStyle(fontWeight: FontWeight.w800)),
                      subtitle: Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Text(
                          ready
                              ? 'Version ${form.version} · Ready offline'
                              : needsDownload
                                  ? 'Version ${form.version} · Tap to download update'
                                  : form.accessStatus == 'pending'
                                      ? 'Waiting for approval'
                                      : 'Access blocked',
                        ),
                      ),
                      trailing: const Icon(Icons.chevron_right_rounded),
                      onTap: () async {
                        if (!form.allowed) {
                          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                            content: Text(form.accessStatus == 'pending'
                                ? 'Waiting for approval. Ask your supervisor to approve '
                                    'this phone in Kura → Live monitor → Devices.'
                                : 'This phone is blocked from this form. Contact your supervisor.'),
                          ));
                          return;
                        }
                        var selected = form;
                        if (selected.schema == null) {
                          final downloaded =
                              await controller.download(form.code);
                          if (downloaded == null) return;
                          selected = downloaded;
                        }
                        if (!context.mounted) return;
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => FormRunnerScreen(form: selected),
                          ),
                        );
                      },
                    ),
                  );
                },
              ),
            )),
            ]),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.color, required this.icon, required this.text, this.onClose});
  final Color color;
  final IconData icon;
  final String text;
  final VoidCallback? onClose;

  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
        padding: const EdgeInsets.fromLTRB(14, 12, 6, 12),
        decoration: BoxDecoration(
          color: color.withValues(alpha: .12),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: color.withValues(alpha: .45)),
        ),
        child: Row(children: [
          Icon(icon, color: color),
          const SizedBox(width: 10),
          Expanded(child: Text(text, style: const TextStyle(fontWeight: FontWeight.w600))),
          if (onClose != null)
            IconButton(icon: const Icon(Icons.close_rounded), onPressed: onClose),
        ]),
      );
}
