import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../core/models/submission_model.dart';
import '../forms/form_runner_screen.dart';
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
                  final isDraft = item.status == 'draft';
                  final (icon, color) = switch (item.syncStatus) {
                    'synced' => (Icons.cloud_done_rounded, Colors.green),
                    'failed' => (Icons.error_outline_rounded, Colors.red),
                    'draft' => (Icons.edit_note_rounded, Colors.orange),
                    _ => (Icons.cloud_upload_outlined, Colors.blue),
                  };
                  return Card(
                    child: ListTile(
                      contentPadding:
                          const EdgeInsets.fromLTRB(14, 14, 6, 14),
                      leading: CircleAvatar(
                        backgroundColor: color.withValues(alpha: .12),
                        child: Icon(icon, color: color),
                      ),
                      title: Text(item.formCode,
                          style: const TextStyle(fontWeight: FontWeight.w800)),
                      subtitle: Text(
                        isDraft
                            ? 'Draft · started ${_fmt(item.startedAt)}\nTap to continue filling'
                            : '${item.status} · ${_fmt(item.startedAt)}\n${item.syncStatus}',
                      ),
                      isThreeLine: true,
                      trailing: isDraft
                          ? PopupMenuButton<String>(
                              onSelected: (action) {
                                if (action == 'open') {
                                  _openDraft(item);
                                } else if (action == 'delete') {
                                  _confirmDelete(item);
                                }
                              },
                              itemBuilder: (_) => const [
                                PopupMenuItem(
                                    value: 'open',
                                    child: ListTile(
                                      leading: Icon(Icons.edit_rounded),
                                      title: Text('Continue filling'),
                                      contentPadding: EdgeInsets.zero,
                                    )),
                                PopupMenuItem(
                                    value: 'delete',
                                    child: ListTile(
                                      leading:
                                          Icon(Icons.delete_outline_rounded),
                                      title: Text('Delete draft'),
                                      contentPadding: EdgeInsets.zero,
                                    )),
                              ],
                            )
                          : null,
                      onTap: isDraft ? () => _openDraft(item) : null,
                    ),
                  );
                },
              ),
            ),
    );
  }

  String _fmt(DateTime dt) =>
      DateFormat('d MMM yyyy, HH:mm').format(dt.toLocal());

  Future<void> _openDraft(LocalSubmission submission) async {
    final database = context.read<SubmissionsController>().database;

    // The runner needs the form's schema to render the questions.
    final form = await database.getForm(submission.formCode);
    if (!mounted) return;

    if (form == null || form.schema == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text(
              'The form for this draft is not on this device anymore. '
              'Re-download it from the Forms tab first.')));
      return;
    }

    if (form.version != submission.version) {
      final proceed = await showDialog<bool>(
        context: context,
        builder: (_) => AlertDialog(
          title: const Text('Form was updated'),
          content: const Text(
              'This draft was started on an older version of the form. '
              'Answers to questions that changed may not carry over. '
              'Continue?'),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('Cancel')),
            FilledButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text('Continue')),
          ],
        ),
      );
      if (proceed != true || !mounted) return;
    }

    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => FormRunnerScreen(form: form, draft: submission),
      ),
    );
    // Refresh: the draft may have been updated or submitted.
    if (mounted) {
      context.read<SubmissionsController>().load();
    }
  }

  Future<void> _confirmDelete(LocalSubmission submission) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Delete this draft?'),
        content: const Text(
            'The answers in this draft will be permanently removed from '
            'this device. This cannot be undone.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(
                backgroundColor: Theme.of(dialogContext).colorScheme.error),
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed == true && mounted) {
      await context.read<SubmissionsController>().delete(submission.uuid);
    }
  }
}