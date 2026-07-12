import 'dart:io';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:signature/signature.dart';
import 'package:uuid/uuid.dart';

import '../../core/models/form_model.dart';
import '../../core/models/submission_model.dart';
import '../submissions/submissions_controller.dart';

class FormRunnerScreen extends StatefulWidget {
  final KuraForm form;

  const FormRunnerScreen({super.key, required this.form});

  @override
  State<FormRunnerScreen> createState() => _FormRunnerScreenState();
}

class _FormRunnerScreenState extends State<FormRunnerScreen> {
  final _formKey = GlobalKey<FormState>();
  final Map<String, dynamic> answers = {};
  final Map<String, TextEditingController> textControllers = {};
  late final DateTime startedAt;
  int pageIndex = 0;

  List<Map<String, dynamic>> get questions {
    final raw = widget.form.schema?['questions'] as List? ?? [];
    return raw
        .whereType<Map>()
        .map((item) => Map<String, dynamic>.from(item))
        .where((item) => item['type'] != 'section')
        .toList();
  }

  @override
  void initState() {
    super.initState();
    startedAt = DateTime.now();
  }

  @override
  void dispose() {
    for (final controller in textControllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final visible = questions.where(_isVisible).toList();
    final total = visible.length;
    final question = total == 0 ? null : visible[pageIndex.clamp(0, total - 1)];

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.form.title),
        actions: [
          TextButton(
            onPressed: () => _save(status: 'draft'),
            child: const Text('Save draft'),
          ),
        ],
      ),
      body: question == null
          ? const Center(child: Text('This form has no questions.'))
          : Form(
              key: _formKey,
              child: Column(
                children: [
                  LinearProgressIndicator(value: (pageIndex + 1) / total),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
                    child: Row(
                      children: [
                        Text('Question ${pageIndex + 1} of $total'),
                        const Spacer(),
                        Text('${(((pageIndex + 1) / total) * 100).round()}%'),
                      ],
                    ),
                  ),
                  Expanded(
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.all(20),
                      child: _QuestionCard(
                        question: question,
                        value: answers[question['name']],
                        controller: _controllerFor(question),
                        onChanged: (value) {
                          setState(() {
                            answers[question['name'].toString()] = value;
                          });
                        },
                      ),
                    ),
                  ),
                  SafeArea(
                    top: false,
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Row(
                        children: [
                          OutlinedButton(
                            onPressed: pageIndex == 0
                                ? null
                                : () => setState(() => pageIndex -= 1),
                            child: const Text('Back'),
                          ),
                          const Spacer(),
                          FilledButton.icon(
                            onPressed: () {
                              if (!_validateCurrent(question)) return;
                              if (pageIndex >= total - 1) {
                                _save(status: 'complete');
                              } else {
                                setState(() => pageIndex += 1);
                              }
                            },
                            icon: Icon(pageIndex >= total - 1
                                ? Icons.check_rounded
                                : Icons.arrow_forward_rounded),
                            label: Text(pageIndex >= total - 1
                                ? 'Complete'
                                : 'Next'),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
    );
  }

  TextEditingController? _controllerFor(Map<String, dynamic> question) {
    final type = question['type']?.toString();
    if (!{'text', 'textarea', 'number', 'decimal', 'phone', 'email'}
        .contains(type)) {
      return null;
    }
    final name = question['name'].toString();
    return textControllers.putIfAbsent(
      name,
      () => TextEditingController(text: answers[name]?.toString() ?? ''),
    );
  }

  bool _validateCurrent(Map<String, dynamic> question) {
    final required = question['required'] == true;
    final value = answers[question['name']];
    if (required &&
        (value == null ||
            value == '' ||
            (value is List && value.isEmpty))) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('This question is required.')),
      );
      return false;
    }
    return true;
  }

  bool _isVisible(Map<String, dynamic> question) {
    final condition = question['show_if'];
    if (condition is! Map) return true;
    final rule = Map<String, dynamic>.from(condition);
    final field = rule['q']?.toString();
    final cmp = rule['cmp']?.toString() ?? 'eq';
    final expected = rule['value'];
    final current = answers[field];
    switch (cmp) {
      case 'eq':
        return current == expected;
      case 'ne':
        return current != expected;
      case 'gt':
        return _num(current) > _num(expected);
      case 'gte':
        return _num(current) >= _num(expected);
      case 'lt':
        return _num(current) < _num(expected);
      case 'lte':
        return _num(current) <= _num(expected);
      case 'contains':
        return current is List
            ? current.contains(expected)
            : current.toString().contains(expected.toString());
      default:
        return true;
    }
  }

  double _num(dynamic value) =>
      double.tryParse(value?.toString() ?? '') ?? 0;

  Future<void> _save({required String status}) async {
    final now = DateTime.now();
    Position? position;
    try {
      if (await Geolocator.isLocationServiceEnabled()) {
        var permission = await Geolocator.checkPermission();
        if (permission == LocationPermission.denied) {
          permission = await Geolocator.requestPermission();
        }
        if (permission == LocationPermission.whileInUse ||
            permission == LocationPermission.always) {
          position = await Geolocator.getCurrentPosition();
        }
      }
    } catch (_) {}

    final submission = LocalSubmission(
      uuid: const Uuid().v4(),
      formCode: widget.form.code,
      version: widget.form.version,
      answers: Map<String, dynamic>.from(answers),
      status: status,
      syncStatus: status == 'draft' ? 'draft' : 'pending',
      startedAt: startedAt,
      submittedAt: status == 'draft' ? null : now,
      durationMs: now.difference(startedAt).inMilliseconds,
      gpsLat: position?.latitude,
      gpsLng: position?.longitude,
    );

    await context.read<SubmissionsController>().save(submission);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(status == 'draft'
            ? 'Draft saved on this device.'
            : 'Response saved offline and queued for sync.'),
      ),
    );
    Navigator.pop(context);
  }
}

class _QuestionCard extends StatefulWidget {
  final Map<String, dynamic> question;
  final dynamic value;
  final ValueChanged<dynamic> onChanged;
  final TextEditingController? controller;

  const _QuestionCard({
    required this.question,
    required this.value,
    required this.onChanged,
    this.controller,
  });

  @override
  State<_QuestionCard> createState() => _QuestionCardState();
}

class _QuestionCardState extends State<_QuestionCard> {
  @override
  Widget build(BuildContext context) {
    final q = widget.question;
    final type = q['type']?.toString() ?? 'text';
    final label = (q['label'] ?? q['name'] ?? 'Question').toString();
    final hint = q['hint']?.toString();

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(label,
                style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w800,
                    )),
            if (hint != null && hint.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(hint),
            ],
            const SizedBox(height: 22),
            _field(type, q),
          ],
        ),
      ),
    );
  }

  Widget _field(String type, Map<String, dynamic> q) {
    switch (type) {
      case 'number':
      case 'decimal':
        return TextField(
          controller: widget.controller,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: const InputDecoration(labelText: 'Enter number'),
          onChanged: (value) => widget.onChanged(
              type == 'number' ? int.tryParse(value) : double.tryParse(value)),
        );
      case 'textarea':
        return TextField(
          controller: widget.controller,
          minLines: 4,
          maxLines: 8,
          decoration: const InputDecoration(labelText: 'Enter response'),
          onChanged: widget.onChanged,
        );
      case 'select_one':
      case 'radio':
        final choices = _choices(q);
        return Column(
          children: choices
              .map(
                (choice) => RadioListTile<String>(
                  value: choice.$1,
                  groupValue: widget.value?.toString(),
                  title: Text(choice.$2),
                  onChanged: widget.onChanged,
                ),
              )
              .toList(),
        );
      case 'select_multiple':
      case 'checkbox':
        final selected =
            widget.value is List ? List<String>.from(widget.value) : <String>[];
        return Column(
          children: _choices(q).map((choice) {
            return CheckboxListTile(
              value: selected.contains(choice.$1),
              title: Text(choice.$2),
              onChanged: (checked) {
                final next = List<String>.from(selected);
                checked == true ? next.add(choice.$1) : next.remove(choice.$1);
                widget.onChanged(next);
              },
            );
          }).toList(),
        );
      case 'date':
        return OutlinedButton.icon(
          icon: const Icon(Icons.calendar_month_rounded),
          label: Text(widget.value == null
              ? 'Choose date'
              : widget.value.toString()),
          onPressed: () async {
            final picked = await showDatePicker(
              context: context,
              firstDate: DateTime(1900),
              lastDate: DateTime(2100),
              initialDate: DateTime.now(),
            );
            if (picked != null) {
              widget.onChanged(DateFormat('yyyy-MM-dd').format(picked));
            }
          },
        );
      case 'time':
        return OutlinedButton.icon(
          icon: const Icon(Icons.schedule_rounded),
          label: Text(widget.value == null
              ? 'Choose time'
              : widget.value.toString()),
          onPressed: () async {
            final picked = await showTimePicker(
              context: context,
              initialTime: TimeOfDay.now(),
            );
            if (picked != null && mounted) {
              widget.onChanged(picked.format(context));
            }
          },
        );
      case 'gps':
        return OutlinedButton.icon(
          icon: const Icon(Icons.my_location_rounded),
          label: Text(widget.value == null
              ? 'Capture location'
              : widget.value.toString()),
          onPressed: () async {
            var permission = await Geolocator.checkPermission();
            if (permission == LocationPermission.denied) {
              permission = await Geolocator.requestPermission();
            }
            if (permission == LocationPermission.whileInUse ||
                permission == LocationPermission.always) {
              final position = await Geolocator.getCurrentPosition();
              widget.onChanged({
                'lat': position.latitude,
                'lng': position.longitude,
                'accuracy': position.accuracy,
              });
            }
          },
        );
      case 'photo':
      case 'image':
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (widget.value != null && File(widget.value.toString()).existsSync())
              ClipRRect(
                borderRadius: BorderRadius.circular(16),
                child: Image.file(File(widget.value.toString()), height: 220),
              ),
            OutlinedButton.icon(
              icon: const Icon(Icons.camera_alt_rounded),
              label: const Text('Take photo'),
              onPressed: () async {
                final image =
                    await ImagePicker().pickImage(source: ImageSource.camera);
                if (image != null) widget.onChanged(image.path);
              },
            ),
          ],
        );
      case 'signature':
        return FilledButton.tonalIcon(
          icon: const Icon(Icons.draw_rounded),
          label: Text(widget.value == null
              ? 'Capture signature'
              : 'Signature captured'),
          onPressed: () async {
            final controller = SignatureController(
              penStrokeWidth: 3,
              penColor: Colors.black,
              exportBackgroundColor: Colors.white,
            );
            final bytes = await showDialog<List<int>>(
              context: context,
              builder: (_) => AlertDialog(
                title: const Text('Signature'),
                content: SizedBox(
                  width: 320,
                  height: 240,
                  child: Signature(
                    controller: controller,
                    backgroundColor: Colors.white,
                  ),
                ),
                actions: [
                  TextButton(
                    onPressed: controller.clear,
                    child: const Text('Clear'),
                  ),
                  FilledButton(
                    onPressed: () async {
                      final data = await controller.toPngBytes();
                      if (!context.mounted) return;
                      Navigator.pop(context, data?.toList());
                    },
                    child: const Text('Save'),
                  ),
                ],
              ),
            );
            if (bytes != null) widget.onChanged(bytes);
          },
        );
      default:
        return TextField(
          controller: widget.controller,
          decoration: const InputDecoration(labelText: 'Enter response'),
          keyboardType:
              type == 'email' ? TextInputType.emailAddress : TextInputType.text,
          onChanged: widget.onChanged,
        );
    }
  }

  List<(String, String)> _choices(Map<String, dynamic> q) {
    final raw = q['choices'] as List? ?? [];
    return raw.map((item) {
      if (item is Map) {
        final map = Map<String, dynamic>.from(item);
        return (
          (map['value'] ?? map['name'] ?? map['label']).toString(),
          (map['label'] ?? map['value'] ?? map['name']).toString()
        );
      }
      return (item.toString(), item.toString());
    }).toList();
  }
}
