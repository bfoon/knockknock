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
    Future.microtask(() => context.read<FormsController>().loadLocal());
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
          : RefreshIndicator(
              onRefresh: controller.refresh,
              child: ListView.separated(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
                itemCount: controller.forms.length,
                separatorBuilder: (_, __) => const SizedBox(height: 12),
                itemBuilder: (context, index) {
                  final form = controller.forms[index];
                  final ready = form.allowed && form.schema != null;
                  return Card(
                    child: ListTile(
                      contentPadding: const EdgeInsets.all(16),
                      leading: CircleAvatar(
                        child: Icon(ready
                            ? Icons.assignment_turned_in_rounded
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
                              : form.accessStatus == 'pending'
                                  ? 'Waiting for approval'
                                  : 'Access blocked',
                        ),
                      ),
                      trailing: const Icon(Icons.chevron_right_rounded),
                      onTap: () async {
                        if (!form.allowed) return;
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
            ),
    );
  }
}
