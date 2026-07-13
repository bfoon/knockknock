import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:provider/provider.dart';
import 'package:signature/signature.dart';
import 'package:uuid/uuid.dart';

import '../../core/models/form_model.dart';
import '../../core/models/submission_model.dart';
import '../submissions/submissions_controller.dart';

/// Kobo/ODK-Collect-style runner: one question per page, swipe or tap to
/// navigate, section breadcrumbs, a jump-to-question sheet, and a review
/// page before submitting. Every question type the Kura builder can emit
/// is normalised through [_normalizeType] so nothing falls back to a bare
/// text field by accident.
class FormRunnerScreen extends StatefulWidget {
  final KuraForm form;

  const FormRunnerScreen({super.key, required this.form});

  @override
  State<FormRunnerScreen> createState() => _FormRunnerScreenState();
}

/// Aliases → canonical types. The builder and older schemas use several
/// spellings; the runner should treat them identically.
String _normalizeType(dynamic raw) {
  final t = raw?.toString().trim().toLowerCase() ?? 'text';
  const aliases = {
    'string': 'text',
    'short_text': 'text',
    'long_text': 'textarea',
    'paragraph': 'textarea',
    'comment': 'textarea',
    'int': 'integer',
    'integer': 'integer',
    'number': 'integer',
    'numeric': 'integer',
    'float': 'decimal',
    'double': 'decimal',
    'currency': 'decimal',
    'tel': 'phone',
    'telephone': 'phone',
    'mobile': 'phone',
    'select': 'select_one',
    'select1': 'select_one',
    'radio': 'select_one',
    'dropdown': 'select_one',
    'choice': 'select_one',
    'select_multiple': 'select_many',
    'select_many': 'select_many',
    'multiselect': 'select_many',
    'checkbox': 'select_many',
    'checkboxes': 'select_many',
    'boolean': 'yesno',
    'yes_no': 'yesno',
    'yesno': 'yesno',
    'datetime': 'datetime',
    'date_time': 'datetime',
    'geopoint': 'gps',
    'location': 'gps',
    'gps': 'gps',
    'image': 'photo',
    'picture': 'photo',
    'photo': 'photo',
    'rating': 'rating',
    'stars': 'rating',
    'scale': 'scale',
    'slider': 'scale',
    'range': 'scale',
    'likert': 'likert',
    'qr': 'barcode',
    'qrcode': 'barcode',
    'scan': 'barcode',
    'barcode': 'barcode',
    'lookup': 'barcode',
    'note': 'note',
    'info': 'note',
  };
  return aliases[t] ?? t;
}

class _FormRunnerScreenState extends State<FormRunnerScreen> {
  final Map<String, dynamic> answers = {};
  final Map<String, TextEditingController> textControllers = {};
  final PageController _pager = PageController();
  late final DateTime startedAt;
  int pageIndex = 0;
  String? inlineError; // shown inside the current question card

  /// Questions with sections folded in as a `_group` breadcrumb on each
  /// following question (instead of being discarded).
  List<Map<String, dynamic>> get questions {
    final raw = widget.form.schema?['questions'] as List? ?? [];
    final result = <Map<String, dynamic>>[];
    String group = '';
    for (final item in raw.whereType<Map>()) {
      final q = Map<String, dynamic>.from(item);
      if (_normalizeType(q['type']) == 'section') {
        group = (q['label'] ?? q['name'] ?? '').toString();
        continue;
      }
      q['_group'] = group;
      result.add(q);
    }
    return result;
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
    _pager.dispose();
    super.dispose();
  }

  // ── build ──────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final visible = questions.where(_isVisible).toList();
    final total = visible.length;
    // Pages: one per visible question + the review page at the end.
    final pageCount = total == 0 ? 0 : total + 1;
    final onReview = pageIndex >= total;

    return PopScope(
      canPop: answers.isEmpty,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _confirmExit();
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(widget.form.title,
              maxLines: 1, overflow: TextOverflow.ellipsis),
          actions: [
            TextButton(
              onPressed: () => _save(status: 'draft'),
              child: const Text('Save draft'),
            ),
          ],
          bottom: total == 0
              ? null
              : PreferredSize(
                  preferredSize: const Size.fromHeight(4),
                  child: TweenAnimationBuilder<double>(
                    tween: Tween(
                        end: onReview ? 1 : (pageIndex + 1) / total),
                    duration: const Duration(milliseconds: 250),
                    builder: (_, v, __) =>
                        LinearProgressIndicator(value: v, minHeight: 4),
                  ),
                ),
        ),
        body: total == 0
            ? const Center(child: Text('This form has no questions.'))
            : Column(
                children: [
                  _counterBar(visible, total, onReview),
                  Expanded(
                    child: PageView.builder(
                      controller: _pager,
                      itemCount: pageCount,
                      onPageChanged: (next) {
                        // Kobo behaviour: swiping back is always free;
                        // swiping forward re-validates the question left.
                        if (next > pageIndex && pageIndex < total) {
                          final err = _errorFor(visible[pageIndex]);
                          if (err != null) {
                            _pager.animateToPage(pageIndex,
                                duration: const Duration(milliseconds: 200),
                                curve: Curves.easeOut);
                            setState(() => inlineError = err);
                            return;
                          }
                        }
                        setState(() {
                          pageIndex = next;
                          inlineError = null;
                        });
                      },
                      itemBuilder: (context, index) {
                        if (index >= total) {
                          return _ReviewPage(
                            questions: visible,
                            answers: answers,
                            errorFor: _errorFor,
                            onJump: _jumpTo,
                          );
                        }
                        final q = visible[index];
                        return SingleChildScrollView(
                          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                          child: _QuestionCard(
                            key: ValueKey('q-${q['name']}'),
                            question: q,
                            value: answers[q['name'].toString()],
                            controller: _controllerFor(q),
                            error: index == pageIndex ? inlineError : null,
                            onChanged: (value) {
                              setState(() {
                                answers[q['name'].toString()] = value;
                                inlineError = null;
                              });
                            },
                          ),
                        );
                      },
                    ),
                  ),
                  _navBar(visible, total, onReview),
                ],
              ),
      ),
    );
  }

  Widget _counterBar(
      List<Map<String, dynamic>> visible, int total, bool onReview) {
    final answered = visible
        .where((q) => _hasAnswer(answers[q['name'].toString()]))
        .length;
    return InkWell(
      onTap: () => _openJumpSheet(visible),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 4),
        child: Row(
          children: [
            Icon(Icons.list_alt_rounded,
                size: 18, color: Theme.of(context).colorScheme.primary),
            const SizedBox(width: 8),
            Text(
              onReview
                  ? 'Review your answers'
                  : 'Question ${pageIndex + 1} of $total',
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            const Spacer(),
            Text('$answered/$total answered',
                style: Theme.of(context).textTheme.bodySmall),
          ],
        ),
      ),
    );
  }

  Widget _navBar(
      List<Map<String, dynamic>> visible, int total, bool onReview) {
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
        child: Row(
          children: [
            OutlinedButton.icon(
              onPressed: pageIndex == 0 ? null : () => _jumpTo(pageIndex - 1),
              icon: const Icon(Icons.arrow_back_rounded, size: 18),
              label: const Text('Back'),
            ),
            const Spacer(),
            FilledButton.icon(
              onPressed: () {
                if (onReview) {
                  _submit(visible);
                  return;
                }
                final err = _errorFor(visible[pageIndex]);
                if (err != null) {
                  setState(() => inlineError = err);
                  return;
                }
                _jumpTo(pageIndex + 1);
              },
              icon: Icon(onReview
                  ? Icons.cloud_done_rounded
                  : pageIndex >= total - 1
                      ? Icons.fact_check_rounded
                      : Icons.arrow_forward_rounded),
              label: Text(onReview
                  ? 'Submit'
                  : pageIndex >= total - 1
                      ? 'Review'
                      : 'Next'),
            ),
          ],
        ),
      ),
    );
  }

  void _jumpTo(int index) {
    _pager.animateToPage(index,
        duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
  }

  void _openJumpSheet(List<Map<String, dynamic>> visible) {
    showModalBottomSheet(
      context: context,
      showDragHandle: true,
      builder: (sheet) => ListView.builder(
        itemCount: visible.length,
        itemBuilder: (_, i) {
          final q = visible[i];
          final done = _hasAnswer(answers[q['name'].toString()]);
          final required = q['required'] == true;
          return ListTile(
            leading: Icon(
              done
                  ? Icons.check_circle_rounded
                  : Icons.radio_button_unchecked_rounded,
              color: done
                  ? Colors.green
                  : required
                      ? Theme.of(context).colorScheme.error
                      : null,
            ),
            title: Text('${i + 1}. ${q['label'] ?? q['name']}',
                maxLines: 1, overflow: TextOverflow.ellipsis),
            subtitle: (q['_group'] as String).isEmpty
                ? null
                : Text(q['_group'].toString(),
                    maxLines: 1, overflow: TextOverflow.ellipsis),
            onTap: () {
              Navigator.pop(sheet);
              _jumpTo(i);
            },
          );
        },
      ),
    );
  }

  Future<void> _confirmExit() async {
    final choice = await showDialog<String>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Leave this form?'),
        content: const Text(
            'You have unsaved answers. Save them as a draft to continue later?'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, 'stay'),
              child: const Text('Keep editing')),
          TextButton(
              onPressed: () => Navigator.pop(context, 'discard'),
              child: const Text('Discard')),
          FilledButton(
              onPressed: () => Navigator.pop(context, 'draft'),
              child: const Text('Save draft')),
        ],
      ),
    );
    if (!mounted) return;
    if (choice == 'draft') {
      await _save(status: 'draft');
    } else if (choice == 'discard') {
      Navigator.pop(context);
    }
  }

  // ── controllers / validation / visibility ──────────────────────────

  TextEditingController? _controllerFor(Map<String, dynamic> question) {
    final type = _normalizeType(question['type']);
    if (!{'text', 'textarea', 'integer', 'decimal', 'phone', 'email'}
        .contains(type)) {
      return null;
    }
    final name = question['name'].toString();
    return textControllers.putIfAbsent(
      name,
      () => TextEditingController(text: answers[name]?.toString() ?? ''),
    );
  }

  bool _hasAnswer(dynamic value) =>
      value != null &&
      value != '' &&
      !(value is List && value.isEmpty);

  /// null → valid; otherwise the message to show. Checks required,
  /// email shape, and numeric min/max from the schema.
  String? _errorFor(Map<String, dynamic> question) {
    final type = _normalizeType(question['type']);
    if (type == 'note') return null;
    final value = answers[question['name'].toString()];
    if (question['required'] == true && !_hasAnswer(value)) {
      return 'This question is required.';
    }
    if (!_hasAnswer(value)) return null;

    if (type == 'email' &&
        !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(value.toString())) {
      return 'Enter a valid email address.';
    }
    if (type == 'integer' || type == 'decimal') {
      final n = double.tryParse(value.toString());
      if (n == null) return 'Enter a valid number.';
      final min = double.tryParse(question['min']?.toString() ?? '');
      final max = double.tryParse(question['max']?.toString() ?? '');
      if (min != null && n < min) return 'Must be at least ${question['min']}.';
      if (max != null && n > max) return 'Must be at most ${question['max']}.';
    }
    return null;
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
        return current?.toString() == expected?.toString();
      case 'ne':
        return current?.toString() != expected?.toString();
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
            ? current.map((e) => e.toString()).contains(expected.toString())
            : current.toString().contains(expected.toString());
      default:
        return true;
    }
  }

  double _num(dynamic value) =>
      double.tryParse(value?.toString() ?? '') ?? 0;

  // ── save / submit ───────────────────────────────────────────────────

  void _submit(List<Map<String, dynamic>> visible) {
    for (var i = 0; i < visible.length; i++) {
      if (_errorFor(visible[i]) != null) {
        _jumpTo(i);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text('Question ${i + 1} needs attention before submitting.')));
        return;
      }
    }
    _save(status: 'complete');
  }

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

    if (!mounted) return;
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

// ── the question card ─────────────────────────────────────────────────

class _QuestionCard extends StatefulWidget {
  final Map<String, dynamic> question;
  final dynamic value;
  final ValueChanged<dynamic> onChanged;
  final TextEditingController? controller;
  final String? error;

  const _QuestionCard({
    super.key,
    required this.question,
    required this.value,
    required this.onChanged,
    this.controller,
    this.error,
  });

  @override
  State<_QuestionCard> createState() => _QuestionCardState();
}

class _QuestionCardState extends State<_QuestionCard> {
  bool _busyGps = false;

  @override
  Widget build(BuildContext context) {
    final q = widget.question;
    final type = _normalizeType(q['type']);
    final label = (q['label'] ?? q['name'] ?? 'Question').toString();
    final hint = q['hint']?.toString();
    final group = (q['_group'] ?? '').toString();
    final required = q['required'] == true;
    final scheme = Theme.of(context).colorScheme;

    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (group.isNotEmpty)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
              color: scheme.primaryContainer,
              child: Text(
                group.toUpperCase(),
                style: TextStyle(
                  color: scheme.onPrimaryContainer,
                  fontWeight: FontWeight.w800,
                  fontSize: 11,
                  letterSpacing: 1.1,
                ),
              ),
            ),
          Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text.rich(
                  TextSpan(
                    text: label,
                    children: required
                        ? [
                            TextSpan(
                                text: ' *',
                                style: TextStyle(color: scheme.error))
                          ]
                        : [],
                  ),
                  style: Theme.of(context)
                      .textTheme
                      .titleLarge
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
                if (hint != null && hint.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(hint,
                      style: TextStyle(color: scheme.onSurfaceVariant)),
                ],
                const SizedBox(height: 20),
                _field(type, q),
                if (widget.error != null) ...[
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: scheme.errorContainer,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Row(
                      children: [
                        Icon(Icons.error_outline_rounded,
                            size: 18, color: scheme.onErrorContainer),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(widget.error!,
                              style:
                                  TextStyle(color: scheme.onErrorContainer)),
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ── one widget per canonical type ───────────────────────────────────

  Widget _field(String type, Map<String, dynamic> q) {
    switch (type) {
      case 'note':
        return const SizedBox.shrink();

      case 'integer':
        return TextField(
          controller: widget.controller,
          keyboardType:
              const TextInputType.numberWithOptions(signed: true),
          inputFormatters: [
            FilteringTextInputFormatter.allow(RegExp(r'^-?\d*')),
          ],
          decoration: _decor('Enter a whole number',
              prefixIcon: Icons.numbers_rounded),
          onChanged: (value) => widget.onChanged(int.tryParse(value)),
        );

      case 'decimal':
        return TextField(
          controller: widget.controller,
          keyboardType: const TextInputType.numberWithOptions(
              signed: true, decimal: true),
          inputFormatters: [
            FilteringTextInputFormatter.allow(RegExp(r'^-?\d*\.?\d*')),
          ],
          decoration:
              _decor('Enter a number', prefixIcon: Icons.numbers_rounded),
          onChanged: (value) => widget.onChanged(double.tryParse(value)),
        );

      case 'phone':
        return TextField(
          controller: widget.controller,
          keyboardType: TextInputType.phone,
          inputFormatters: [
            FilteringTextInputFormatter.allow(RegExp(r'^[+\d\s-]*')),
          ],
          decoration:
              _decor('Enter phone number', prefixIcon: Icons.call_rounded),
          onChanged: widget.onChanged,
        );

      case 'email':
        return TextField(
          controller: widget.controller,
          keyboardType: TextInputType.emailAddress,
          autocorrect: false,
          decoration: _decor('name@example.com',
              prefixIcon: Icons.alternate_email_rounded),
          onChanged: widget.onChanged,
        );

      case 'textarea':
        return TextField(
          controller: widget.controller,
          minLines: 4,
          maxLines: 10,
          textCapitalization: TextCapitalization.sentences,
          decoration: _decor('Enter response'),
          onChanged: widget.onChanged,
        );

      case 'select_one':
        final current = widget.value?.toString();
        return Column(
          children: _choices(q).map((choice) {
            final selected = current == choice.$1;
            return _choiceTile(
              selected: selected,
              child: RadioListTile<String>(
                value: choice.$1,
                groupValue: current,
                title: Text(choice.$2),
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 8),
                onChanged: (v) => widget.onChanged(v),
              ),
            );
          }).toList(),
        );

      case 'select_many':
        final selected = widget.value is List
            ? List<String>.from(
                (widget.value as List).map((e) => e.toString()))
            : <String>[];
        return Column(
          children: _choices(q).map((choice) {
            final isOn = selected.contains(choice.$1);
            return _choiceTile(
              selected: isOn,
              child: CheckboxListTile(
                value: isOn,
                title: Text(choice.$2),
                controlAffinity: ListTileControlAffinity.leading,
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 8),
                onChanged: (checked) {
                  final next = List<String>.from(selected);
                  checked == true
                      ? next.add(choice.$1)
                      : next.remove(choice.$1);
                  widget.onChanged(next);
                },
              ),
            );
          }).toList(),
        );

      case 'yesno':
        final current = widget.value?.toString();
        return SegmentedButton<String>(
          segments: const [
            ButtonSegment(
                value: 'yes',
                label: Text('Yes'),
                icon: Icon(Icons.check_rounded)),
            ButtonSegment(
                value: 'no',
                label: Text('No'),
                icon: Icon(Icons.close_rounded)),
          ],
          emptySelectionAllowed: true,
          selected: current == null ? {} : {current},
          onSelectionChanged: (set) =>
              widget.onChanged(set.isEmpty ? null : set.first),
        );

      case 'rating':
        final max = int.tryParse(q['max']?.toString() ?? '') ?? 5;
        final current = int.tryParse(widget.value?.toString() ?? '') ?? 0;
        return Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: List.generate(max.clamp(2, 10), (i) {
            final n = i + 1;
            return IconButton(
              iconSize: 36,
              icon: Icon(
                n <= current
                    ? Icons.star_rounded
                    : Icons.star_border_rounded,
                color: n <= current ? Colors.amber : null,
              ),
              onPressed: () => widget.onChanged(n),
            );
          }),
        );

      case 'scale':
        final min = double.tryParse(q['min']?.toString() ?? '') ?? 0;
        final max = double.tryParse(q['max']?.toString() ?? '') ?? 10;
        final current =
            (double.tryParse(widget.value?.toString() ?? '') ?? min)
                .clamp(min, max);
        return Column(
          children: [
            Text('${current.round()}',
                style: Theme.of(context)
                    .textTheme
                    .headlineMedium
                    ?.copyWith(fontWeight: FontWeight.w900)),
            Slider(
              value: current,
              min: min,
              max: max <= min ? min + 1 : max,
              divisions: (max - min).round().clamp(1, 100),
              label: '${current.round()}',
              onChanged: (v) => widget.onChanged(v.round()),
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('${min.round()}',
                    style: Theme.of(context).textTheme.bodySmall),
                Text('${max.round()}',
                    style: Theme.of(context).textTheme.bodySmall),
              ],
            ),
          ],
        );

      case 'likert':
        final choices = _choices(q).isNotEmpty
            ? _choices(q)
            : const [
                ('1', 'Strongly disagree'),
                ('2', 'Disagree'),
                ('3', 'Neutral'),
                ('4', 'Agree'),
                ('5', 'Strongly agree'),
              ];
        final current = widget.value?.toString();
        return Wrap(
          spacing: 8,
          runSpacing: 8,
          children: choices
              .map((c) => ChoiceChip(
                    label: Text(c.$2),
                    selected: current == c.$1,
                    onSelected: (_) => widget.onChanged(c.$1),
                  ))
              .toList(),
        );

      case 'date':
        return _pickerTile(
          icon: Icons.calendar_month_rounded,
          empty: 'Choose date',
          onClear: () => widget.onChanged(null),
          onTap: () async {
            final picked = await showDatePicker(
              context: context,
              firstDate: DateTime(1900),
              lastDate: DateTime(2100),
              initialDate:
                  DateTime.tryParse(widget.value?.toString() ?? '') ??
                      DateTime.now(),
            );
            if (picked != null) {
              widget.onChanged(DateFormat('yyyy-MM-dd').format(picked));
            }
          },
        );

      case 'time':
        return _pickerTile(
          icon: Icons.schedule_rounded,
          empty: 'Choose time',
          onClear: () => widget.onChanged(null),
          onTap: () async {
            final picked = await showTimePicker(
              context: context,
              initialTime: TimeOfDay.now(),
            );
            if (picked != null && context.mounted) {
              widget.onChanged(picked.format(context));
            }
          },
        );

      case 'datetime':
        return _pickerTile(
          icon: Icons.event_rounded,
          empty: 'Choose date & time',
          onClear: () => widget.onChanged(null),
          onTap: () async {
            final date = await showDatePicker(
              context: context,
              firstDate: DateTime(1900),
              lastDate: DateTime(2100),
              initialDate: DateTime.now(),
            );
            if (date == null || !context.mounted) return;
            final time = await showTimePicker(
                context: context, initialTime: TimeOfDay.now());
            if (time == null) return;
            final dt = DateTime(
                date.year, date.month, date.day, time.hour, time.minute);
            widget.onChanged(
                DateFormat('yyyy-MM-dd HH:mm').format(dt));
          },
        );

      case 'gps':
        final value = widget.value;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (value is Map) ...[
              ListTile(
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                    side: BorderSide(
                        color: Theme.of(context).dividerColor)),
                leading: const Icon(Icons.place_rounded),
                title: Text(
                    '${_fmtCoord(value['lat'])}, ${_fmtCoord(value['lng'])}'),
                subtitle: value['accuracy'] == null
                    ? null
                    : Text(
                        'Accuracy ±${(value['accuracy'] as num).toStringAsFixed(0)} m'),
              ),
              const SizedBox(height: 10),
            ],
            FilledButton.tonalIcon(
              icon: _busyGps
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.my_location_rounded),
              label: Text(_busyGps
                  ? 'Getting location…'
                  : value == null
                      ? 'Capture location'
                      : 'Capture again'),
              onPressed: _busyGps ? null : _captureGps,
            ),
          ],
        );

      case 'photo':
        final path = widget.value?.toString();
        final hasFile = path != null && File(path).existsSync();
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (hasFile) ...[
              ClipRRect(
                borderRadius: BorderRadius.circular(16),
                child: Image.file(File(path),
                    height: 220, fit: BoxFit.cover),
              ),
              const SizedBox(height: 10),
            ],
            Row(
              children: [
                Expanded(
                  child: FilledButton.tonalIcon(
                    icon: const Icon(Icons.camera_alt_rounded),
                    label: Text(hasFile ? 'Retake' : 'Camera'),
                    onPressed: () => _pickImage(ImageSource.camera),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton.icon(
                    icon: const Icon(Icons.photo_library_rounded),
                    label: const Text('Gallery'),
                    onPressed: () => _pickImage(ImageSource.gallery),
                  ),
                ),
                if (hasFile)
                  IconButton(
                    tooltip: 'Remove photo',
                    icon: const Icon(Icons.delete_outline_rounded),
                    onPressed: () => widget.onChanged(null),
                  ),
              ],
            ),
          ],
        );

      case 'barcode':
        final code = widget.value?.toString();
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (code != null && code.isNotEmpty) ...[
              ListTile(
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                    side: BorderSide(
                        color: Theme.of(context).dividerColor)),
                leading: const Icon(Icons.qr_code_2_rounded),
                title: Text(code,
                    style: const TextStyle(fontWeight: FontWeight.w700)),
              ),
              const SizedBox(height: 10),
            ],
            FilledButton.tonalIcon(
              icon: const Icon(Icons.qr_code_scanner_rounded),
              label: Text(code == null ? 'Scan code' : 'Scan again'),
              onPressed: () async {
                final scanned = await Navigator.push<String>(
                  context,
                  MaterialPageRoute(builder: (_) => const _ScannerPage()),
                );
                if (scanned != null) widget.onChanged(scanned);
              },
            ),
          ],
        );

      case 'signature':
        final captured = widget.value != null;
        return FilledButton.tonalIcon(
          icon: Icon(captured
              ? Icons.check_circle_rounded
              : Icons.draw_rounded),
          label:
              Text(captured ? 'Signature captured — redo' : 'Capture signature'),
          onPressed: _captureSignature,
        );

      default: // 'text' and anything unknown
        return TextField(
          controller: widget.controller,
          textCapitalization: TextCapitalization.sentences,
          decoration: _decor('Enter response'),
          onChanged: widget.onChanged,
        );
    }
  }

  // ── field helpers ───────────────────────────────────────────────────

  InputDecoration _decor(String hint, {IconData? prefixIcon}) =>
      InputDecoration(
        hintText: hint,
        prefixIcon: prefixIcon == null ? null : Icon(prefixIcon),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
        filled: true,
      );

  Widget _choiceTile({required bool selected, required Widget child}) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          width: selected ? 2 : 1,
          color: selected ? scheme.primary : Theme.of(context).dividerColor,
        ),
        color: selected ? scheme.primary.withOpacity(.06) : null,
      ),
      child: child,
    );
  }

  Widget _pickerTile({
    required IconData icon,
    required String empty,
    required VoidCallback onTap,
    required VoidCallback onClear,
  }) {
    final value = widget.value?.toString();
    return ListTile(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: Theme.of(context).dividerColor),
      ),
      leading: Icon(icon),
      title: Text(value ?? empty,
          style: TextStyle(
              fontWeight: value == null ? FontWeight.w400 : FontWeight.w700)),
      trailing: value == null
          ? const Icon(Icons.chevron_right_rounded)
          : IconButton(
              icon: const Icon(Icons.clear_rounded), onPressed: onClear),
      onTap: onTap,
    );
  }

  String _fmtCoord(dynamic v) =>
      (double.tryParse(v?.toString() ?? '') ?? 0).toStringAsFixed(5);

  Future<void> _captureGps() async {
    setState(() => _busyGps = true);
    try {
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
      } else if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Location permission is needed for this question.')));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Could not get a GPS fix. Try again outdoors.')));
      }
    } finally {
      if (mounted) setState(() => _busyGps = false);
    }
  }

  Future<void> _pickImage(ImageSource source) async {
    final image =
        await ImagePicker().pickImage(source: source, imageQuality: 80);
    if (image != null) widget.onChanged(image.path);
  }

  Future<void> _captureSignature() async {
    final controller = SignatureController(
      penStrokeWidth: 3,
      penColor: Colors.black,
      exportBackgroundColor: Colors.white,
    );
    final bytes = await showDialog<List<int>>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Signature'),
        contentPadding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
        content: SizedBox(
          width: MediaQuery.of(dialogContext).size.width,
          height: 260,
          child: DecoratedBox(
            decoration: BoxDecoration(
              border: Border.all(color: Colors.black26),
              borderRadius: BorderRadius.circular(12),
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: Signature(
                controller: controller,
                backgroundColor: Colors.white,
              ),
            ),
          ),
        ),
        actions: [
          TextButton(
              onPressed: controller.clear, child: const Text('Clear')),
          TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Cancel')),
          FilledButton(
            onPressed: () async {
              final data = await controller.toPngBytes();
              if (!dialogContext.mounted) return;
              Navigator.pop(dialogContext, data?.toList());
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (bytes != null) widget.onChanged(bytes);
  }

  List<(String, String)> _choices(Map<String, dynamic> q) {
    final raw = q['choices'] as List? ?? q['options'] as List? ?? [];
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

// ── review page ───────────────────────────────────────────────────────

class _ReviewPage extends StatelessWidget {
  final List<Map<String, dynamic>> questions;
  final Map<String, dynamic> answers;
  final String? Function(Map<String, dynamic>) errorFor;
  final void Function(int) onJump;

  const _ReviewPage({
    required this.questions,
    required this.answers,
    required this.errorFor,
    required this.onJump,
  });

  String _summary(Map<String, dynamic> q, dynamic value) {
    if (value == null || value == '') return '—';
    final type = _normalizeType(q['type']);
    if (type == 'gps' && value is Map) {
      return '${value['lat']}, ${value['lng']}';
    }
    if (type == 'signature') return 'Signature captured';
    if (type == 'photo') return 'Photo attached';
    if (value is List) {
      if (value.isEmpty) return '—';
      if (value.first is int) return 'Signature captured';
      return value.map((e) => e.toString()).join(', ');
    }
    return value.toString();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      children: [
        Text('Review before submitting',
            style: Theme.of(context)
                .textTheme
                .titleLarge
                ?.copyWith(fontWeight: FontWeight.w800)),
        const SizedBox(height: 4),
        Text('Tap any answer to edit it.',
            style: TextStyle(color: scheme.onSurfaceVariant)),
        const SizedBox(height: 12),
        ...List.generate(questions.length, (i) {
          final q = questions[i];
          if (_normalizeType(q['type']) == 'note') {
            return const SizedBox.shrink();
          }
          final err = errorFor(q);
          final value = answers[q['name'].toString()];
          return Card(
            margin: const EdgeInsets.only(bottom: 8),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
              side: err != null
                  ? BorderSide(color: scheme.error, width: 1.5)
                  : BorderSide.none,
            ),
            child: ListTile(
              leading: Icon(
                err != null
                    ? Icons.error_outline_rounded
                    : Icons.check_circle_outline_rounded,
                color: err != null
                    ? scheme.error
                    : value == null
                        ? scheme.outline
                        : Colors.green,
              ),
              title: Text('${i + 1}. ${q['label'] ?? q['name']}',
                  maxLines: 2, overflow: TextOverflow.ellipsis),
              subtitle: Text(err ?? _summary(q, value),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: err != null
                      ? TextStyle(color: scheme.error)
                      : null),
              trailing: const Icon(Icons.edit_rounded, size: 18),
              onTap: () => onJump(i),
            ),
          );
        }),
      ],
    );
  }
}

// ── barcode scanner page ──────────────────────────────────────────────

class _ScannerPage extends StatefulWidget {
  const _ScannerPage();

  @override
  State<_ScannerPage> createState() => _ScannerPageState();
}

class _ScannerPageState extends State<_ScannerPage> {
  bool _done = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Scan code')),
      body: MobileScanner(
        onDetect: (capture) {
          if (_done) return;
          final raw = capture.barcodes.isEmpty
              ? null
              : capture.barcodes.first.rawValue;
          if (raw == null || raw.isEmpty) return;
          _done = true;
          Navigator.pop(context, raw);
        },
      ),
    );
  }
}