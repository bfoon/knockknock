import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'submissions_controller.dart';

class SubmissionsScreen extends StatefulWidget {
  const SubmissionsScreen({super.key});

  @override
  State<SubmissionsScreen> createState() => _SubmissionsScreenState();
}

class _SubmissionsScreenState extends State<SubmissionsScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() => context.read<SubmissionsController>().load());
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<SubmissionsController>();
    return Scaffold(
      appBar: AppBar(
        title: const Text('Records'),
        actions: [
          IconButton(
            onPressed: controller.syncing ? null : controller.sync,
            icon: controller.syncing
                ? const SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.sync_rounded),
          ),
        ],
      ),
      body: controller.submissions.isEmpty
          ? const Center(child: Text('No locally saved records yet.'))
          : RefreshIndicator(
              onRefresh: controller.load,
              child: ListView.separated(
                padding: const EdgeInsets.all(16),
                itemCount: controller.submissions.length,
                separatorBuilder: (_, __) => const SizedBox(height: 10),
                itemBuilder: (context, index) {
                  final item = controller.submissions[index];
                  final (icon, color) = switch (item.syncStatus) {
                    'synced' => (Icons.cloud_done_rounded, Colors.green),
                    'failed' => (Icons.error_outline_rounded, Colors.red),
                    'draft' => (Icons.edit_note_rounded, Colors.orange),
                    _ => (Icons.cloud_upload_outlined, Colors.blue),
                  };
                  return Card(
                    child: ListTile(
                      contentPadding: const EdgeInsets.all(14),
                      leading: CircleAvatar(
                        backgroundColor: color.withValues(alpha: .12),
                        child: Icon(icon, color: color),
                      ),
                      title: Text(item.formCode,
                          style: const TextStyle(fontWeight: FontWeight.w800)),
                      subtitle: Text(
                        '${item.status} · ${item.startedAt.toLocal()}\n${item.syncStatus}',
                      ),
                      isThreeLine: true,
                    ),
                  );
                },
              ),
            ),
    );
  }
}
