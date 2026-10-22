import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../auth/auth_controller.dart';
import '../../core/services/sync_engine.dart';
import '../submissions/submissions_controller.dart';
import '../sync/sync_center.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    final submissions = context.watch<SubmissionsController>();
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Column(
              children: [
                ListTile(
                  leading: const CircleAvatar(child: Icon(Icons.person_rounded)),
                  title: Text(auth.username ?? 'Kura user'),
                  subtitle: const Text('Registered field device'),
                ),
                const Divider(height: 1),
                ListTile(
                  leading: const Icon(Icons.cloud_sync_rounded),
                  title: const Text('Sync center'),
                  subtitle: Text(
                    '${submissions.pending} not yet on the server · '
                    'auto-sync ${context.watch<SyncEngine>().settings.autoSync ? 'on' : 'off'}',
                  ),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () => SyncCenterSheet.show(context),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Card(
            child: ListTile(
              leading: Icon(Icons.logout_rounded,
                  color: Theme.of(context).colorScheme.error),
              title: Text('Sign out',
                  style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                      fontWeight: FontWeight.w700)),
              onTap: () async {
                final confirmed = await showDialog<bool>(
                  context: context,
                  builder: (_) => AlertDialog(
                    title: const Text('Sign out?'),
                    content: const Text(
                      'Downloaded forms and saved records will remain on this device.',
                    ),
                    actions: [
                      TextButton(
                          onPressed: () => Navigator.pop(context, false),
                          child: const Text('Cancel')),
                      FilledButton(
                          onPressed: () => Navigator.pop(context, true),
                          child: const Text('Sign out')),
                    ],
                  ),
                );
                if (confirmed == true && context.mounted) {
                  await context.read<AuthController>().logout();
                }
              },
            ),
          ),
        ],
      ),
    );
  }
}
