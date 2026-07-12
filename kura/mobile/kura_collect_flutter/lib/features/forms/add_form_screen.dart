import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:provider/provider.dart';

import 'forms_controller.dart';

class AddFormScreen extends StatefulWidget {
  const AddFormScreen({super.key});

  @override
  State<AddFormScreen> createState() => _AddFormScreenState();
}

class _AddFormScreenState extends State<AddFormScreen> {
  final _code = TextEditingController();
  bool scanning = false;
  bool handled = false;

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<FormsController>();
    return Scaffold(
      appBar: AppBar(title: const Text('Add form')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text('Download a Kura form',
              style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                  )),
          const SizedBox(height: 8),
          const Text(
            'Scan the QR code provided by your supervisor or enter the form code.',
          ),
          const SizedBox(height: 24),
          if (scanning)
            ClipRRect(
              borderRadius: BorderRadius.circular(24),
              child: SizedBox(
                height: 320,
                child: MobileScanner(
                  onDetect: (capture) {
                    if (handled || capture.barcodes.isEmpty) return;
                    final value = capture.barcodes.first.rawValue;
                    if (value == null) return;
                    handled = true;
                    _code.text = _extractCode(value);
                    setState(() => scanning = false);
                    _submit();
                  },
                ),
              ),
            )
          else
            OutlinedButton.icon(
              onPressed: () {
                handled = false;
                setState(() => scanning = true);
              },
              icon: const Icon(Icons.qr_code_scanner_rounded),
              label: const Padding(
                padding: EdgeInsets.symmetric(vertical: 16),
                child: Text('Scan QR code'),
              ),
            ),
          const SizedBox(height: 20),
          const Row(
            children: [
              Expanded(child: Divider()),
              Padding(
                padding: EdgeInsets.symmetric(horizontal: 12),
                child: Text('OR'),
              ),
              Expanded(child: Divider()),
            ],
          ),
          const SizedBox(height: 20),
          TextField(
            controller: _code,
            textCapitalization: TextCapitalization.characters,
            decoration: const InputDecoration(
              labelText: 'Form code',
              hintText: 'ABC123',
              prefixIcon: Icon(Icons.password_rounded),
            ),
          ),
          const SizedBox(height: 14),
          FilledButton.icon(
            onPressed: controller.loading ? null : _submit,
            icon: controller.loading
                ? const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.download_rounded),
            label: const Padding(
              padding: EdgeInsets.symmetric(vertical: 14),
              child: Text('Verify and download'),
            ),
          ),
          if (controller.error != null) ...[
            const SizedBox(height: 12),
            Text(
              controller.error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ],
        ],
      ),
    );
  }

  String _extractCode(String raw) {
    final uri = Uri.tryParse(raw);
    if (uri != null) {
      final queryCode = uri.queryParameters['code'];
      if (queryCode != null && queryCode.isNotEmpty) return queryCode;
      if (uri.pathSegments.isNotEmpty) {
        return uri.pathSegments.last;
      }
    }
    return raw.trim();
  }

  Future<void> _submit() async {
    final code = _code.text.trim();
    if (code.isEmpty) return;
    final form = await context.read<FormsController>().addByCode(code);
    if (!mounted || form == null) return;

    if (form.allowed && form.schema != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${form.title} downloaded.')),
      );
      Navigator.pop(context);
      return;
    }

    final message = form.accessStatus == 'pending'
        ? 'Access requested. A supervisor must approve this device.'
        : 'This device is blocked from this form.';
    showDialog<void>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(form.title),
        content: Text(message),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('OK')),
        ],
      ),
    );
  }
}
