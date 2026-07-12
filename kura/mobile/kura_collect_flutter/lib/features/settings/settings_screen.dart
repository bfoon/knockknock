import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../auth/auth_controller.dart';
import '../submissions/submissions_controller.dart';

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
                  leading: const Icon(Icons.sync_rounded),
                  title: const Text('Synchronize data'),
                  subtitle: Text('${submissions.pending} pending records'),
                  onTap: submissions.syncing ? null : submissions.sync,
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
