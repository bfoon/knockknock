import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../forms/add_form_screen.dart';
import '../forms/forms_controller.dart';
import '../submissions/submissions_controller.dart';

class OverviewScreen extends StatefulWidget {
  const OverviewScreen({super.key});

  @override
  State<OverviewScreen> createState() => _OverviewScreenState();
}

class _OverviewScreenState extends State<OverviewScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      context.read<FormsController>().loadLocal();
      context.read<FormsController>().refresh();
      context.read<SubmissionsController>().load();
    });
  }

  @override
  Widget build(BuildContext context) {
    final forms = context.watch<FormsController>();
    final submissions = context.watch<SubmissionsController>();
    return Scaffold(
      appBar: AppBar(
        title: const Text('Kura Collect'),
        actions: [
          IconButton(
            onPressed: submissions.syncing
                ? null
                : () => submissions.sync(),
            icon: submissions.syncing
                ? const SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.sync_rounded),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          await forms.refresh();
          await submissions.load();
        },
        child: ListView(
          padding: const EdgeInsets.all(18),
          children: [
            Container(
              padding: const EdgeInsets.all(22),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFF5B4BDB), Color(0xFF8B5CF6)],
                ),
                borderRadius: BorderRadius.circular(28),
              ),
              child: const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.offline_bolt_rounded,
                      color: Colors.white, size: 34),
                  SizedBox(height: 28),
                  Text('Ready for fieldwork',
                      style: TextStyle(
                          color: Colors.white,
                          fontSize: 26,
                          fontWeight: FontWeight.w800)),
                  SizedBox(height: 8),
                  Text(
                    'Forms and responses remain available without internet.',
                    style: TextStyle(color: Colors.white70, fontSize: 15),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 18),
            Row(
              children: [
                Expanded(
                  child: _MetricCard(
                    label: 'Forms',
                    value: forms.forms.length.toString(),
                    icon: Icons.assignment_rounded,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _MetricCard(
                    label: 'Pending sync',
                    value: submissions.pending.toString(),
                    icon: Icons.cloud_upload_outlined,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 22),
            Text('Quick actions',
                style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w800,
                    )),
            const SizedBox(height: 12),
            Card(
              child: Column(
                children: [
                  ListTile(
                    leading: const CircleAvatar(
                        child: Icon(Icons.qr_code_scanner_rounded)),
                    title: const Text('Scan or enter form code'),
                    subtitle: const Text('Download a form to this device'),
                    trailing: const Icon(Icons.chevron_right_rounded),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const AddFormScreen()),
                    ),
                  ),
                  const Divider(height: 1),
                  ListTile(
                    leading:
                        const CircleAvatar(child: Icon(Icons.sync_rounded)),
                    title: const Text('Synchronize now'),
                    subtitle: Text('${submissions.pending} records waiting'),
                    trailing: const Icon(Icons.chevron_right_rounded),
                    onTap: submissions.syncing
                        ? null
                        : () => submissions.sync(),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MetricCard extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;

  const _MetricCard({
    required this.label,
    required this.value,
    required this.icon,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: Theme.of(context).colorScheme.primary),
            const SizedBox(height: 20),
            Text(value,
                style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                      fontWeight: FontWeight.w900,
                    )),
            Text(label),
          ],
        ),
      ),
    );
  }
}
