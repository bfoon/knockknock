// ─────────────────────────────────────────────────────────────────────
// Wiring for the Records screen: tap a draft to resume it, long-press
// (or swipe) to delete. Adapt names to your actual records screen —
// that file wasn't shared, so this shows the pieces to drop in.
// ─────────────────────────────────────────────────────────────────────

// 1. SubmissionsController — add a delete method (and make sure `save`
//    upserts by uuid, so resuming a draft overwrites it, not duplicates):

/*
class SubmissionsController extends ChangeNotifier {
  // ...existing code...

  Future<void> delete(String uuid) async {
    await database.deleteSubmission(uuid);
    submissions = await database.getSubmissions();
    notifyListeners();
  }
}
*/

// 2. AppDatabase — the two queries the flow depends on:

/*
Future<void> deleteSubmission(String uuid) =>
    db.delete('submissions', where: 'uuid = ?', whereArgs: [uuid]);

// upsertSubmission must use ConflictAlgorithm.replace (or INSERT OR
// REPLACE) keyed on uuid — otherwise resuming a draft creates a copy.
*/

// 3. In the records list itemBuilder — the tile for each submission:

/*
final isDraft = submission.status == 'draft';

Card(
  child: ListTile(
    leading: CircleAvatar(
      child: Icon(isDraft
          ? Icons.edit_note_rounded
          : Icons.check_circle_rounded),
    ),
    title: Text(formTitleFor(submission.formCode)),
    subtitle: Text(isDraft
        ? 'Draft · started ${DateFormat('d MMM, HH:mm').format(submission.startedAt)}'
        : 'Submitted ${DateFormat('d MMM, HH:mm').format(submission.submittedAt!)}'),
    trailing: isDraft
        ? PopupMenuButton<String>(
            onSelected: (action) {
              if (action == 'open') _openDraft(context, submission);
              if (action == 'delete') _confirmDelete(context, submission);
            },
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'open', child: Text('Continue filling')),
              PopupMenuItem(value: 'delete', child: Text('Delete draft')),
            ],
          )
        : null,
    onTap: isDraft ? () => _openDraft(context, submission) : null,
  ),
)
*/

// 4. The two handlers:

/*
Future<void> _openDraft(
    BuildContext context, LocalSubmission submission) async {
  // Load the form the draft belongs to (needs its schema to render).
  final form = await context
      .read<FormsController>()
      .database
      .getForm(submission.formCode);

  if (form == null || form.schema == null) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text(
            'The form for this draft is no longer on this device. '
            'Re-download it from the Forms tab first.')));
    return;
  }

  if (form.version != submission.version) {
    // Schema may have changed since the draft was started. Answers for
    // renamed/removed questions are simply ignored by the runner, so
    // resuming is safe — but warn the user.
    if (!context.mounted) return;
    final proceed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Form was updated'),
        content: const Text(
            'This draft was started on an older version of the form. '
            'Some answers may not carry over. Continue?'),
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
    if (proceed != true) return;
  }

  if (!context.mounted) return;
  await Navigator.push(
    context,
    MaterialPageRoute(
      builder: (_) => FormRunnerScreen(form: form, draft: submission),
    ),
  );
  // Refresh the list after coming back (draft may now be submitted).
  if (context.mounted) {
    context.read<SubmissionsController>().load();
  }
}

Future<void> _confirmDelete(
    BuildContext context, LocalSubmission submission) async {
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (_) => AlertDialog(
      title: const Text('Delete this draft?'),
      content: const Text(
          'The answers in this draft will be permanently removed from '
          'this device. This cannot be undone.'),
      actions: [
        TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel')),
        FilledButton(
          style: FilledButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error),
          onPressed: () => Navigator.pop(context, true),
          child: const Text('Delete'),
        ),
      ],
    ),
  );
  if (confirmed == true && context.mounted) {
    await context.read<SubmissionsController>().delete(submission.uuid);
  }
}
*/
