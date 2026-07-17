import 'dart:io';
import 'dart:math' as math;

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
///
/// Skip logic and constraints work like KoboToolbox (see [LogicEvaluator]):
///  • Visibility: `relevant` / `show_if` / `skip_logic` / `condition` /
///    `visible_if` on a question — or on a section, which then gates every
///    question inside it (group relevance). Relevance cascades: a hidden
///    question's answer is invisible to conditions of later questions.
///  • Constraints: `constraint` (+ `constraint_message`) with `.` as the
///    current answer, plus min/max, min_expr/max_expr, min_length/
///    max_length, pattern/regex, min_selected/max_selected, and
///    `required_message`. `warn_expr`/`warn_message` show a non-blocking
///    amber warning, matching the web runner.
///  • Calculated questions (`type: calculate`) are evaluated on-device in
///    document order, exactly like the web runner's context(): their
///    values feed later relevance, constraints, `${name}` piping and
///    repeat `count_expr`. A calc with `visible: true` renders as a
///    read-only result page; all others never get a page.
///  • Repeat groups (`type: repeat`) render as one page holding a card
///    per item, with add/remove controls (KoboCollect-style roster).
///    Answer shape matches the server: answers[group] = [{child: value}].
///    Child skip logic sees the current item's answers first, then the
///    outer answers; child calcs are computed per item; bounds come from
///    repeat.min/max, min_expr/max_expr, or count_expr (which auto-sizes
///    the item list and hides add/remove). Errors read
///    "Member 2 — Age: …", mirroring the server's group.idx.child keys.
///  • `${name}` piping is applied to labels, hints and repeat item
///    labels; repeat aggregates (sum_of, avg_of, min_of, max_of,
///    count_if) are available in every expression.
///  • Non-relevant answers are kept in drafts but stripped from completed
///    submissions — including per-item irrelevant repeat children —
///    exactly like Kobo and the server's validate_submission.
class FormRunnerScreen extends StatefulWidget {
  final KuraForm form;

  /// When set, the runner resumes this draft: answers are pre-filled and
  /// saving (draft or submit) updates the same record instead of creating
  /// a new one.
  final LocalSubmission? draft;

  const FormRunnerScreen({super.key, required this.form, this.draft});

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
    'rank': 'rank',
    'ranking': 'rank',
    'order': 'rank',
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
    'calculate': 'calculate',
    'calc': 'calculate',
    'calculated': 'calculate',
    'hidden': 'calculate',
    'repeat': 'repeat',
    'repeat_group': 'repeat',
    'group_repeat': 'repeat',
    'roster': 'repeat',
  };
  return aliases[t] ?? t;
}

Map<String, dynamic> _validationMap(Map<String, dynamic> question) =>
    question['validate'] is Map
        ? Map<String, dynamic>.from(question['validate'] as Map)
        : <String, dynamic>{};

dynamic _questionSetting(Map<String, dynamic> question, String key) {
  final validation = _validationMap(question);
  return validation.containsKey(key) ? validation[key] : question[key];
}

// ── Kobo/ODK-style logic evaluation ───────────────────────────────────
//
// Evaluates the logic the schema attaches to a question. Works for both
// visibility (skip logic) and constraints, and accepts three shapes:
//
//   String – an XLSForm expression, exactly like KoboToolbox:
//              "${age} >= 18 and selected(${languages}, 'en')"
//            In constraints, '.' refers to the current answer:
//              ". >= 0 and . <= 120"
//            Supported: = != > >= < <=, and/or, + - * / % div mod ^ **,
//            parentheses, and the functions not(), selected(),
//            count-selected(), string-length(), regex(), coalesce(),
//            number(), string(), boolean(), today(), true(), false(),
//            plus the repeat aggregates sum_of(), avg_of(), min_of(),
//            max_of(), count_if().
//
//   Map    – the legacy rule {q, cmp, value} with cmp in eq/ne/gt/gte/
//            lt/lte/contains/empty/not_empty, plus combinators
//            {all: [rules]}, {any: [rules]}, {not: rule}.
//
//   List   – a list of any of the above, combined with AND.
//
// Malformed logic must never block data collection in the field, so any
// evaluation error makes the condition pass (question stays visible,
// constraint is treated as satisfied).
class LogicEvaluator {
  LogicEvaluator(this.answers, {this.dot});

  /// Answers visible to the expression (hidden questions excluded).
  final Map<String, dynamic> answers;

  /// The value of '.' — the current question's answer (constraints only).
  final dynamic dot;

  bool call(dynamic spec) {
    if (spec == null) return true;
    if (spec is bool) return spec;
    if (spec is num) return spec != 0;
    if (spec is String) {
      final source = spec.trim();
      if (source.isEmpty) return true;
      try {
        return _truthy(_ExprParser(source, answers, dot).parse());
      } catch (_) {
        return true;
      }
    }
    if (spec is List) return spec.every(call);
    if (spec is Map) {
      final rule = Map<String, dynamic>.from(spec);

      // Kura builder/server format:
      // {"op":"and"|"or", "rules":[rule, nestedGroup, ...]}
      // This must be checked before treating the map as a leaf rule.
      if (rule['rules'] is List) {
        final rules = (rule['rules'] as List);
        if (rules.isEmpty) return true;
        final op = (rule['op'] ?? 'and').toString().toLowerCase();
        return op == 'or' ? rules.any(call) : rules.every(call);
      }

      // Older/mobile-compatible group formats.
      if (rule['all'] is List) return (rule['all'] as List).every(call);
      if (rule['any'] is List) return (rule['any'] as List).any(call);
      if (rule.containsKey('not')) return !call(rule['not']);
      return _legacyRule(rule);
    }
    return true;
  }

  bool _legacyRule(Map<String, dynamic> rule) {
    final field = (rule['q'] ?? rule['field'])?.toString();
    final cmp = (rule['cmp'] ?? rule['op'] ?? 'eq')
        .toString()
        .trim()
        .toLowerCase();
    final expected = rule['value'];
    final current = field == null ? dot : answers[field];

    switch (cmp) {
      case 'answered':
      case 'not_empty':
        return _hasValue(current);
      case 'not_answered':
      case 'empty':
        return !_hasValue(current);

      case 'selected':
      case 'not_selected': {
        final selected = current is List
            ? current.map((e) => e.toString()).toList()
            : (_hasValue(current) ? <String>[current.toString()] : <String>[]);
        final hit = selected.contains(expected?.toString() ?? '');
        return cmp == 'selected' ? hit : !hit;
      }

      case 'in':
      case 'not_in': {
        final options = expected is List ? expected : <dynamic>[expected];
        final hit = options
            .map((e) => e?.toString() ?? '')
            .contains(current?.toString() ?? '');
        return cmp == 'in' ? hit : !hit;
      }

      case 'contains':
      case 'not_contains': {
        final hit = expected != null &&
            current != null &&
            current
                .toString()
                .toLowerCase()
                .contains(expected.toString().toLowerCase());
        return cmp == 'contains' ? hit : !hit;
      }

      case 'matches':
        try {
          return RegExp(expected?.toString() ?? '')
              .hasMatch(current?.toString() ?? '');
        } catch (_) {
          return false;
        }

      case 'between':
        if (expected is! List || expected.length != 2) return false;
        final n = double.tryParse(current?.toString() ?? '');
        final lo = double.tryParse(expected[0]?.toString() ?? '');
        final hi = double.tryParse(expected[1]?.toString() ?? '');
        return n != null && lo != null && hi != null && n >= lo && n <= hi;

      case 'eq':
        return _looseEq(current, expected);
      case 'ne':
      case 'neq':
        return !_looseEq(current, expected);
      case 'gt':
        return _numOf(current) > _numOf(expected);
      case 'gte':
        return _numOf(current) >= _numOf(expected);
      case 'lt':
        return _numOf(current) < _numOf(expected);
      case 'lte':
        return _numOf(current) <= _numOf(expected);
      default:
        // Invalid/malformed rules fail open, so field collection is not
        // blocked by a bad form definition.
        return true;
    }
  }
}

bool _truthy(dynamic v) {
  if (v == null) return false;
  if (v is bool) return v;
  if (v is num) return v != 0;
  if (v is List) return v.isNotEmpty;
  return v.toString().isNotEmpty;
}

bool _hasValue(dynamic v) =>
    v != null && v != '' && !(v is List && v.isEmpty);

/// NaN for non-numeric input, so `'' > 5` is simply false instead of
/// silently treating blanks as zero.
double _numOf(dynamic v) => double.tryParse(v?.toString() ?? '') ?? double.nan;

/// Numeric when both sides parse as numbers (so int 18 == "18.0"),
/// string comparison otherwise. null and '' are considered equal.
bool _looseEq(dynamic a, dynamic b) {
  final na = double.tryParse(a?.toString() ?? '');
  final nb = double.tryParse(b?.toString() ?? '');
  if (na != null && nb != null) return na == nb;
  return (a ?? '').toString() == (b ?? '').toString();
}

double _pow10(int exponent) => math.pow(10, exponent).toDouble();
double _pow(double base, double exponent) =>
    math.pow(base, exponent).toDouble();
double _sqrt(double value) => math.sqrt(value);

dynamic _expressionValue(dynamic spec, Map<String, dynamic> answers,
    {dynamic dot}) {
  if (spec == null) return null;
  if (spec is num || spec is bool) return spec;
  final source = spec.toString().trim();
  if (source.isEmpty) return null;
  try {
    return _ExprParser(source, answers, dot).parse();
  } catch (_) {
    return null;
  }
}

double? _expressionNumber(dynamic spec, Map<String, dynamic> answers,
    {dynamic dot}) {
  final value = _expressionValue(spec, answers, dot: dot);
  if (value is bool) return value ? 1.0 : 0.0;
  return double.tryParse(value?.toString() ?? '');
}

/// Minimal recursive-descent parser for XLSForm/XPath-ish expressions —
/// also accepts the Python-flavoured operators the server's calc engine
/// uses (`/`, `%`, `**`), so builder calc expressions evaluate
/// identically on the phone. Precedence (low → high): or, and,
/// comparison, + -, * / % div mod, unary -, ^/** (right-assoc).
class _ExprParser {
  _ExprParser(this.source, this.answers, this.dot);

  final String source;
  final Map<String, dynamic> answers;
  final dynamic dot;
  int _pos = 0;

  dynamic parse() {
    final value = _or();
    _ws();
    if (_pos < source.length) {
      throw FormatException('Unexpected input at $_pos');
    }
    return value;
  }

  dynamic _or() {
    var left = _and();
    while (_keyword('or')) {
      final l = _truthy(left);
      final r = _truthy(_and());
      left = l || r;
    }
    return left;
  }

  dynamic _and() {
    var left = _comparison();
    while (_keyword('and')) {
      final l = _truthy(left);
      final r = _truthy(_comparison());
      left = l && r;
    }
    return left;
  }

  dynamic _comparison() {
    final left = _additive();
    _ws();
    for (final op in const ['!=', '>=', '<=', '==', '=', '>', '<']) {
      if (_match(op)) {
        final right = _additive();
        switch (op) {
          case '=':
          case '==':
            return _looseEq(left, right);
          case '!=':
            return !_looseEq(left, right);
          case '>':
            return _numOf(left) > _numOf(right);
          case '>=':
            return _numOf(left) >= _numOf(right);
          case '<':
            return _numOf(left) < _numOf(right);
          case '<=':
            return _numOf(left) <= _numOf(right);
        }
      }
    }
    return left;
  }

  dynamic _additive() {
    var left = _multiplicative();
    while (true) {
      _ws();
      if (_match('+')) {
        left = _numOf(left) + _numOf(_multiplicative());
      } else if (_match('-')) {
        left = _numOf(left) - _numOf(_multiplicative());
      } else {
        break;
      }
    }
    return left;
  }

  dynamic _multiplicative() {
    var left = _unary();
    while (true) {
      _ws();
      // Division/modulo mirror the server: divide-by-zero yields 0, not
      // Infinity, so a calc like `total / count(members)` stays sane on
      // an empty roster.
      if (_match('*')) {
        left = _numOf(left) * _numOf(_unary());
      } else if (_match('/')) {
        final b = _numOf(_unary());
        left = b == 0 ? 0.0 : _numOf(left) / b;
      } else if (_keyword('div')) {
        final b = _numOf(_unary());
        left = b == 0 ? 0.0 : _numOf(left) / b;
      } else if (_match('%')) {
        final b = _numOf(_unary());
        left = b == 0 ? 0.0 : _numOf(left) % b;
      } else if (_keyword('mod')) {
        final b = _numOf(_unary());
        left = b == 0 ? 0.0 : _numOf(left) % b;
      } else {
        break;
      }
    }
    return left;
  }

  dynamic _unary() {
    _ws();
    if (_match('-')) return -_numOf(_unary());
    return _power();
  }

  /// Exponentiation: `^` (builder syntax) or `**` (Python syntax the
  /// server accepts). Right-associative, binds tighter than * and /.
  dynamic _power() {
    final base = _primary();
    _ws();
    if (_match('**') || _match('^')) {
      return _pow(_numOf(base), _numOf(_unary()));
    }
    return base;
  }

  dynamic _primary() {
    _ws();
    if (_pos >= source.length) throw const FormatException('Unexpected end');
    final c = source[_pos];

    if (c == '(') {
      _pos++;
      final value = _or();
      _expect(')');
      return value;
    }

    if (c == "'" || c == '"') return _stringLiteral(c);

    // ${field_name}
    if (c == r'$' && _pos + 1 < source.length && source[_pos + 1] == '{') {
      _pos += 2;
      final end = source.indexOf('}', _pos);
      if (end < 0) throw const FormatException(r'Unclosed ${…}');
      final name = source.substring(_pos, end).trim();
      _pos = end + 1;
      return answers[name];
    }

    // Number literal (before the lone-dot check).
    final numMatch =
        RegExp(r'\d+(\.\d+)?').matchAsPrefix(source, _pos);
    if (numMatch != null) {
      _pos = numMatch.end;
      return double.parse(numMatch.group(0)!);
    }

    // '.' — the current answer (constraint expressions).
    if (c == '.') {
      _pos++;
      return dot;
    }

    // Identifier: keyword literal or function call. Hyphens allowed so
    // XPath names like string-length and count-selected tokenize whole.
    final idMatch = RegExp(r'[A-Za-z_][A-Za-z0-9_]*(?:-[A-Za-z][A-Za-z0-9_]*)*')
        .matchAsPrefix(source, _pos);
    if (idMatch != null) {
      final name = idMatch.group(0)!;
      _pos = idMatch.end;
      _ws();
      if (_pos < source.length && source[_pos] == '(') {
        _pos++;
        final args = <dynamic>[];
        _ws();
        if (_pos < source.length && source[_pos] != ')') {
          args.add(_or());
          _ws();
          while (_match(',')) {
            args.add(_or());
            _ws();
          }
        }
        _expect(')');
        return _function(name, args);
      }
      switch (name) {
        case 'true':
          return true;
        case 'false':
          return false;
        case 'null':
          return null;
        case 'value':
          return dot;
      }

      // Kura's server-side validate.expr/min_expr/max_expr syntax uses
      // bare field names (for example: age >= minimum_age), while XLSForm
      // relevance commonly uses ${age}. Support both syntaxes.
      if (answers.containsKey(name)) return answers[name];
      return null;
    }

    throw FormatException('Unexpected character "$c"');
  }

  dynamic _function(String name, List<dynamic> args) {
    dynamic arg(int i) => i < args.length ? args[i] : null;
    switch (name) {
      case 'not':
        return !_truthy(arg(0));
      case 'selected': {
        final haystack = arg(0);
        final needle = (arg(1) ?? '').toString();
        if (haystack is List) {
          return haystack.map((e) => e.toString()).contains(needle);
        }
        final s = (haystack ?? '').toString().trim();
        return s.split(RegExp(r'\s+')).contains(needle);
      }
      case 'count-selected': {
        final v = arg(0);
        if (v is List) return v.length.toDouble();
        final s = (v ?? '').toString().trim();
        return s.isEmpty ? 0.0 : s.split(RegExp(r'\s+')).length.toDouble();
      }
      case 'string-length':
        return (arg(0) ?? '').toString().length.toDouble();
      case 'regex':
        try {
          return RegExp((arg(1) ?? '').toString())
              .hasMatch((arg(0) ?? '').toString());
        } catch (_) {
          return true;
        }
      case 'coalesce':
        for (final value in args) {
          if (_hasValue(value)) return value;
        }
        return 0.0;
      case 'number':
      case 'float':
        return _numOf(arg(0));
      case 'int':
        return _numOf(arg(0)).truncateToDouble();
      case 'string':
        return (arg(0) ?? '').toString();
      case 'boolean':
      case 'boolean-from-string':
        return _truthy(arg(0));
      case 'abs':
        return _numOf(arg(0)).abs();
      case 'min':
        return args.map(_numOf).reduce((a, b) => a < b ? a : b);
      case 'max':
        return args.map(_numOf).reduce((a, b) => a > b ? a : b);
      case 'round':
        final digits = args.length > 1 ? _numOf(arg(1)).toInt() : 0;
        final factor = digits <= 0 ? 1.0 : _pow10(digits);
        return (_numOf(arg(0)) * factor).roundToDouble() / factor;
      case 'pow':
        return _pow(_numOf(arg(0)), _numOf(arg(1)));
      case 'sqrt':
        return _sqrt(_numOf(arg(0)));
      case 'count':
        final value = arg(0);
        if (value is List) return value.length.toDouble();
        return _hasValue(value) ? 1.0 : 0.0;
      case 'if_':
        return _truthy(arg(0)) ? arg(1) : arg(2);
      case 'today':
        return DateFormat('yyyy-MM-dd').format(DateTime.now());
      case 'true':
        return true;
      case 'false':
        return false;

      // ── repeat-group aggregates, mirroring kura/logic.py ────────────
      // First arg is a repeat answer (a List of item Maps), second the
      // child column name. Non-numeric / missing values are skipped,
      // matching the server, so mixed rosters never explode.
      case 'sum_of':
      case 'avg_of':
      case 'min_of':
      case 'max_of': {
        final items = arg(0);
        final col = (arg(1) ?? '').toString();
        final values = <double>[];
        if (items is List) {
          for (final item in items) {
            if (item is Map) {
              final n = double.tryParse(item[col]?.toString() ?? '');
              if (n != null) values.add(n);
            }
          }
        }
        if (name == 'sum_of') {
          return values.fold<double>(0.0, (a, b) => a + b);
        }
        if (values.isEmpty) return 0.0;
        switch (name) {
          case 'avg_of':
            return values.reduce((a, b) => a + b) / values.length;
          case 'min_of':
            return values.reduce((a, b) => a < b ? a : b);
          default: // max_of
            return values.reduce((a, b) => a > b ? a : b);
        }
      }
      case 'count_if': {
        final items = arg(0);
        final col = (arg(1) ?? '').toString();
        final cmp = (arg(2) ?? 'eq').toString();
        final ref = double.tryParse(arg(3)?.toString() ?? '');
        if (items is! List || ref == null) return 0.0;
        var hits = 0;
        for (final item in items) {
          if (item is! Map) continue;
          final n = double.tryParse(item[col]?.toString() ?? '');
          if (n == null) continue;
          final ok = switch (cmp) {
            'eq' => n == ref,
            'ne' => n != ref,
            'gt' => n > ref,
            'gte' => n >= ref,
            'lt' => n < ref,
            'lte' => n <= ref,
            _ => false,
          };
          if (ok) hits++;
        }
        return hits.toDouble();
      }

      default:
        throw FormatException('Unknown function "$name"');
    }
  }

  // ── lexing helpers ──────────────────────────────────────────────────

  void _ws() {
    while (_pos < source.length && source[_pos].trim().isEmpty) {
      _pos++;
    }
  }

  bool _match(String token) {
    _ws();
    if (!source.startsWith(token, _pos)) return false;
    _pos += token.length;
    return true;
  }

  /// Matches a whole word (and/or/div/mod) — never part of an identifier.
  bool _keyword(String word) {
    _ws();
    if (!source.startsWith(word, _pos)) return false;
    final end = _pos + word.length;
    if (end < source.length &&
        RegExp(r'[A-Za-z0-9_\-]').hasMatch(source[end])) {
      return false;
    }
    _pos = end;
    return true;
  }

  void _expect(String token) {
    if (!_match(token)) throw FormatException('Expected "$token"');
  }

  String _stringLiteral(String quote) {
    _pos++; // opening quote
    final end = source.indexOf(quote, _pos);
    if (end < 0) throw const FormatException('Unclosed string literal');
    final value = source.substring(_pos, end);
    _pos = end + 1;
    return value;
  }
}

// ── shared, context-aware helpers ─────────────────────────────────────
// These take an explicit `ctx` (answers + calcs, possibly a repeat item
// context) instead of reading the screen's answers map, so exactly the
// same code validates top-level questions and repeat-group children.

/// `${name}` piping in labels/hints/item labels, like the web runner's
/// pipeText(): lists join with commas, whole-number doubles lose ".0".
final RegExp _pipePattern = RegExp(r'\$\{([A-Za-z_][A-Za-z0-9_]*)\}');

String _pipe(dynamic text, Map<String, dynamic> ctx) {
  final s = text?.toString() ?? '';
  if (s.isEmpty || !s.contains(r'${')) return s;
  return s.replaceAllMapped(_pipePattern, (m) {
    final v = ctx[m.group(1)];
    if (v == null || v == '') return '';
    if (v is List) return v.map((e) => e.toString()).join(', ');
    final n = double.tryParse(v.toString());
    if (n != null && n == n.roundToDouble() && v is! String) {
      return n.toInt().toString();
    }
    return v.toString();
  });
}

/// The skip-logic spec of a question/section, whichever key the
/// builder used.
dynamic _conditionOf(Map<String, dynamic> q) =>
    q['relevant'] ??
    q['show_if'] ??
    q['skip_logic'] ??
    q['skipLogic'] ??
    q['condition'] ??
    q['visible_if'];

List<dynamic>? _rawChoicesOf(Map<String, dynamic> question) {
  final raw = question['choices'] ?? question['options'];
  return raw is List ? raw : null;
}

/// The choice values the respondent may legitimately pick right now,
/// honouring cascading selects. Inside a repeat item, `ctx` contains the
/// item's answers layered over the outer answers, so a cascade parent
/// can be a sibling in the same item or a top-level question.
Set<String>? _allowedChoiceValuesIn(
    Map<String, dynamic> question, Map<String, dynamic> ctx) {
  final raw = _rawChoicesOf(question);
  if (raw == null) return null;

  final cascade = question['cascade'] is Map
      ? Map<String, dynamic>.from(question['cascade'] as Map)
      : <String, dynamic>{};
  final parentName = (cascade['parent'] ?? question['cascade_parent'] ?? '')
      .toString()
      .trim();
  final parentValue = parentName.isEmpty ? null : ctx[parentName];

  final allowed = <String>{};
  for (final item in raw) {
    if (item is Map) {
      final choice = Map<String, dynamic>.from(item);
      if (parentName.isNotEmpty) {
        if (!_hasValue(parentValue)) continue;
        if ((choice['parent'] ?? '').toString() != parentValue.toString()) {
          continue;
        }
      }
      allowed.add(
          (choice['value'] ?? choice['name'] ?? choice['label']).toString());
    } else if (parentName.isEmpty) {
      allowed.add(item.toString());
    }
  }
  return allowed;
}

/// A copy of the question with cascade-filtered choices, ready to render.
Map<String, dynamic> _questionForDisplayIn(
    Map<String, dynamic> question, Map<String, dynamic> ctx) {
  final allowed = _allowedChoiceValuesIn(question, ctx);
  if (allowed == null) return question;

  final raw = _rawChoicesOf(question)!;
  final filtered = raw.where((item) {
    if (item is Map) {
      final choice = Map<String, dynamic>.from(item);
      final value =
          (choice['value'] ?? choice['name'] ?? choice['label']).toString();
      return allowed.contains(value);
    }
    return allowed.contains(item.toString());
  }).toList();

  return Map<String, dynamic>.from(question)..['choices'] = filtered;
}

String _displayNumber(double value) =>
    value == value.roundToDouble() ? value.toInt().toString() : value.toString();

// ── repeat groups ─────────────────────────────────────────────────────

List<Map<String, dynamic>> _childrenOf(Map<String, dynamic> q) =>
    (q['children'] as List? ?? const [])
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();

Map<String, dynamic> _repeatSpec(Map<String, dynamic> q) => q['repeat'] is Map
    ? Map<String, dynamic>.from(q['repeat'] as Map)
    : <String, dynamic>{};

/// Bounds mirror the web runner's repeatBounds()/server logic:
/// count_expr fixes the exact number of items (0–500, auto-sized);
/// min/max plus min_expr/max_expr set static + dynamic limits.
({int? exact, double? lo, double? hi}) _repeatBounds(
    Map<String, dynamic> rp, Map<String, dynamic> ctx) {
  final exactRaw = _expressionNumber(rp['count_expr'], ctx);
  final exact =
      exactRaw == null ? null : exactRaw.truncate().clamp(0, 500).toInt();

  double? lo = double.tryParse(rp['min']?.toString() ?? '');
  final dynLo = _expressionNumber(rp['min_expr'], ctx);
  if (dynLo != null) lo = lo == null ? dynLo : math.max(lo, dynLo);

  double? hi = double.tryParse(rp['max']?.toString() ?? '');
  final dynHi = _expressionNumber(rp['max_expr'], ctx);
  if (dynHi != null) hi = hi == null ? dynHi : math.min(hi, dynHi);

  return (exact: exact, lo: lo, hi: hi);
}

/// The item context the server and web runner use: the current item's
/// answers layered over the outer answers, then per-item calcs, so a
/// child's logic can depend on a sibling or on an outer question.
Map<String, dynamic> _itemContext(Map<String, dynamic> q,
    Map<String, dynamic> item, Map<String, dynamic> ctx) {
  final ic = <String, dynamic>{...ctx, ...item};
  for (final ch in _childrenOf(q)) {
    if (_normalizeType(ch['type']) == 'calculate') {
      final name = ch['name']?.toString();
      if (name != null && name.isNotEmpty) {
        ic[name] = _expressionValue(ch['calc'], ic);
      }
    }
  }
  return ic;
}

String _itemLabel(
    Map<String, dynamic> rp, int index, Map<String, dynamic> ic) {
  final template = (rp['item_label'] ?? r'Item ${index}').toString();
  return _pipe(template.replaceAll(r'${index}', '${index + 1}'), ic);
}

List<Map<String, dynamic>> _itemsOf(dynamic value) {
  if (value is List) {
    return [
      for (final item in value)
        item is Map ? Map<String, dynamic>.from(item) : <String, dynamic>{}
    ];
  }
  return <Map<String, dynamic>>[];
}

/// Validates a whole repeat group: bounds, required, then every child of
/// every item with its per-item context. Returns the first problem as a
/// human message ("Member 2 — Age: Must be at least 0."), mirroring the
/// server's group.<index>.<child> error keys.
String? _repeatError(Map<String, dynamic> q, dynamic value,
    Map<String, dynamic> ctx) {
  final items = _itemsOf(value);
  final rp = _repeatSpec(q);
  final bounds = _repeatBounds(rp, ctx);

  if (bounds.exact != null && items.length != bounds.exact) {
    return bounds.exact == 0
        ? 'Answer the controlling question first — it sets how many items this group needs.'
        : 'Exactly ${bounds.exact} item(s) required.';
  }
  if (bounds.exact == null &&
      bounds.lo != null &&
      items.length < bounds.lo!) {
    return 'Add at least ${bounds.lo!.toInt()} item(s).';
  }
  if (bounds.exact == null &&
      bounds.hi != null &&
      items.length > bounds.hi!) {
    return 'No more than ${bounds.hi!.toInt()} item(s) allowed.';
  }
  if (q['required'] == true && items.isEmpty) {
    return 'Add at least one item.';
  }

  final children = _childrenOf(q);
  for (var idx = 0; idx < items.length; idx++) {
    final item = items[idx];
    final ic = _itemContext(q, item, ctx);
    final label = _itemLabel(rp, idx, ic);
    for (final ch in children) {
      final ctype = _normalizeType(ch['type']);
      if (ctype == 'section' || ctype == 'note' || ctype == 'calculate') {
        continue;
      }
      final cname = ch['name']?.toString();
      if (cname == null || cname.isEmpty) continue;
      if (!LogicEvaluator(ic)(_conditionOf(ch))) continue;

      final cval = item[cname];
      final chLabel = (ch['label'] ?? cname).toString();
      if (ch['required'] == true && !_hasValue(cval)) {
        final custom = _validationMap(ch)['message'] ?? ch['required_message'];
        final text = custom?.toString().trim();
        return '$label — $chLabel: '
            '${(text == null || text.isEmpty) ? 'This answer is required.' : text}';
      }
      if (!_hasValue(cval)) continue;
      final err = _errorForQuestion(ch, cval, ic);
      if (err != null) return '$label — $chLabel: $err';
    }
  }
  return null;
}

// ── validation ────────────────────────────────────────────────────────

/// null → valid; otherwise the message to show. Kobo-style checks:
/// required (+ required_message), built-in type validation, min/max,
/// min_expr/max_expr, min_length/max_length, regex pattern, min/max
/// selected choices, date bounds, cascading-choice enforcement, and
/// finally a free-form `constraint` expression where '.' is the current
/// answer (+ constraint_message). Repeat groups delegate to
/// [_repeatError]. `ctx` is the answer context the question sees —
/// top-level answers + calcs, or a repeat item context.
String? _errorForQuestion(Map<String, dynamic> question, dynamic value,
    Map<String, dynamic> ctx) {
  final type = _normalizeType(question['type']);
  if (type == 'note' || type == 'calculate' || type == 'section') return null;
  if (type == 'repeat') return _repeatError(question, value, ctx);

  final name = question['name'].toString();
  final validation = _validationMap(question);

  dynamic setting(String key) =>
      validation.containsKey(key) ? validation[key] : question[key];

  String msg(dynamic custom, String fallback) {
    final s = custom?.toString().trim();
    return (s == null || s.isEmpty) ? fallback : s;
  }

  final validationMessage = validation['message'] ??
      question['constraint_message'] ??
      question['required_message'];

  if (question['required'] == true && !_hasValue(value)) {
    return msg(question['required_message'] ?? validation['message'],
        'This question is required.');
  }
  if (!_hasValue(value)) return null;

  if (type == 'email' &&
      !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(value.toString())) {
    return 'Enter a valid email address.';
  }

  // Kura stores validation under question.validate. Keep top-level
  // fallbacks so older downloaded forms continue to work.
  if (const {'integer', 'decimal', 'rating', 'scale'}.contains(type)) {
    final n = double.tryParse(value.toString());
    if (n == null) return 'Enter a valid number.';
    if (type == 'integer' && n != n.roundToDouble()) {
      return 'Enter a whole number.';
    }

    double? min = double.tryParse(setting('min')?.toString() ?? '');
    double? max = double.tryParse(setting('max')?.toString() ?? '');
    final dynamicMin =
        _expressionNumber(validation['min_expr'], ctx, dot: value);
    final dynamicMax =
        _expressionNumber(validation['max_expr'], ctx, dot: value);
    if (dynamicMin != null) {
      min = min == null ? dynamicMin : math.max(min, dynamicMin).toDouble();
    }
    if (dynamicMax != null) {
      max = max == null ? dynamicMax : math.min(max, dynamicMax).toDouble();
    }

    if (min != null && n < min) {
      return msg(validationMessage, 'Must be at least ${_displayNumber(min)}.');
    }
    if (max != null && n > max) {
      return msg(validationMessage, 'Must be at most ${_displayNumber(max)}.');
    }
  }

  // Text-like answers: length limits and regex pattern.
  if (const {'text', 'textarea', 'phone', 'email', 'barcode'}
      .contains(type)) {
    final text = value.toString();
    final minLen = int.tryParse(
        (validation['min_length'] ?? question['min_length'])?.toString() ??
            '');
    final maxLen = int.tryParse(
        (validation['max_length'] ?? question['max_length'])?.toString() ??
            '');
    if (minLen != null && text.length < minLen) {
      return msg(validationMessage, 'Must be at least $minLen characters.');
    }
    if (maxLen != null && text.length > maxLen) {
      return msg(validationMessage, 'Must be at most $maxLen characters.');
    }

    final pattern =
        (validation['regex'] ?? question['pattern'] ?? question['regex'])
            ?.toString();
    if (pattern != null && pattern.isNotEmpty) {
      try {
        if (!RegExp(pattern).hasMatch(text)) {
          return msg(
              validationMessage, 'The answer is not in the expected format.');
        }
      } catch (_) {
        // Broken form regexes fail open, matching server behaviour.
      }
    }
  }

  // Enforce cascading choice conditions on-device as well as on the
  // server, so changing a parent cannot leave an invalid child choice.
  if (const {'select_one', 'select_many', 'likert', 'rank'}.contains(type)) {
    final allowed = _allowedChoiceValuesIn(question, ctx);
    if (allowed != null) {
      final selected = value is List ? value : <dynamic>[value];
      if (selected.any((item) => !allowed.contains(item.toString()))) {
        return 'Choose only an option currently available for this answer.';
      }
    }
  }

  // Select counts are validate.min/max in the server schema.
  if ((type == 'select_many' || type == 'rank') && value is List) {
    final minSelected = int.tryParse(
        (validation['min'] ?? question['min_selected'])?.toString() ?? '');
    final maxSelected = int.tryParse(
        (validation['max'] ?? question['max_selected'])?.toString() ?? '');
    if (minSelected != null && value.length < minSelected) {
      return msg(validationMessage,
          'Select at least $minSelected option${minSelected == 1 ? '' : 's'}.');
    }
    if (maxSelected != null && value.length > maxSelected) {
      return msg(validationMessage,
          'Select at most $maxSelected option${maxSelected == 1 ? '' : 's'}.');
    }
  }

  // ISO dates compare correctly as strings (yyyy-MM-dd).
  if (const {'date', 'datetime'}.contains(type)) {
    final min = setting('min')?.toString();
    final max = setting('max')?.toString();
    final text = value.toString();
    if (min != null && min.isNotEmpty && text.compareTo(min) < 0) {
      return msg(validationMessage, 'Must be on or after $min.');
    }
    if (max != null && max.isNotEmpty && text.compareTo(max) > 0) {
      return msg(validationMessage, 'Must be on or before $max.');
    }
  }

  // Server schema: validate.expr. Legacy/XLSForm schema: constraint.
  // The parser supports both bare names (`age >= 18`) and `${age}`.
  final constraint =
      validation['expr'] ?? question['constraint'] ?? question['validate_if'];
  if (constraint != null) {
    final context = Map<String, dynamic>.from(ctx)
      ..['value'] = value
      ..[name] = value;
    final ok = LogicEvaluator(context, dot: value)(constraint);
    if (!ok) {
      return msg(validationMessage,
          'The answer does not meet the condition for this question.');
    }
  }
  return null;
}

/// Soft warning (validate.warn_expr / warn_message) — shown in amber and
/// never blocks, exactly like the web runner. null → no warning.
String? _warnFor(Map<String, dynamic> question, dynamic value,
    Map<String, dynamic> ctx) {
  if (!_hasValue(value)) return null;
  final validation = _validationMap(question);
  final warn = validation['warn_expr'];
  if (warn == null || warn.toString().trim().isEmpty) return null;
  final name = question['name']?.toString();
  final context = Map<String, dynamic>.from(ctx)..['value'] = value;
  if (name != null && name.isNotEmpty) context[name] = value;
  final ok = LogicEvaluator(context, dot: value)(warn);
  if (ok) return null;
  final custom = validation['warn_message']?.toString().trim();
  return (custom == null || custom.isEmpty)
      ? 'Please double-check this answer.'
      : custom;
}

class _FormRunnerScreenState extends State<FormRunnerScreen> {
  final Map<String, dynamic> answers = {};
  final Map<String, TextEditingController> textControllers = {};
  final PageController _pager = PageController();
  late final DateTime startedAt;
  late final String _submissionUuid;
  bool _dirty = false; // true once anything changed since open/last save
  int pageIndex = 0;
  String? inlineError; // shown inside the current question card

  /// Questions with sections folded in as a `_group` breadcrumb on each
  /// following question (instead of being discarded).
  List<Map<String, dynamic>> get questions {
    final raw = widget.form.schema?['questions'] as List? ?? [];
    final result = <Map<String, dynamic>>[];
    String group = '';
    dynamic groupCondition;
    for (final item in raw.whereType<Map>()) {
      final q = Map<String, dynamic>.from(item);
      if (_normalizeType(q['type']) == 'section') {
        group = (q['label'] ?? q['name'] ?? '').toString();
        // A condition on the section hides every question inside it,
        // exactly like group relevance in KoboToolbox.
        groupCondition = _conditionOf(q);
        continue;
      }
      q['_group'] = group;
      if (groupCondition != null) q['_group_relevant'] = groupCondition;
      result.add(q);
    }
    return result;
  }

  @override
  void initState() {
    super.initState();
    final draft = widget.draft;
    if (draft != null) {
      answers.addAll(draft.answers);
      startedAt = draft.startedAt;
      _submissionUuid = draft.uuid; // saving updates the same record
    } else {
      startedAt = DateTime.now();
      _submissionUuid = const Uuid().v4();
    }
  }

  @override
  void dispose() {
    for (final controller in textControllers.values) {
      controller.dispose();
    }
    _pager.dispose();
    super.dispose();
  }

  /// Visible questions + the effective answer context, computed together
  /// in document order (Kobo behaviour):
  ///  • Calculated questions are evaluated into the context (so later
  ///    relevance, constraints, piping and repeat count_expr can use
  ///    them) but only get a page of their own when `visible: true`.
  ///  • Relevance cascades: a hidden question's answer is invisible to
  ///    the conditions of every question after it, so hiding a parent
  ///    automatically hides children that depend on it — even though the
  ///    stale answer is still kept in [answers] in case it becomes
  ///    visible again.
  ({List<Map<String, dynamic>> visible, Map<String, dynamic> ctx})
      _computeVisible() {
    final effective = <String, dynamic>{};
    final result = <Map<String, dynamic>>[];
    for (final q in questions) {
      final evaluator = LogicEvaluator(effective);
      final relevant =
          evaluator(q['_group_relevant']) && evaluator(_conditionOf(q));
      final type = _normalizeType(q['type']);

      if (type == 'calculate') {
        if (relevant) {
          final name = q['name']?.toString();
          if (name != null && name.isNotEmpty) {
            effective[name] = _expressionValue(q['calc'], effective);
          }
          if (q['visible'] == true) result.add(q); // read-only result page
        }
        continue;
      }

      if (!relevant) continue;
      result.add(q);
      final name = q['name'].toString();
      if (answers.containsKey(name)) effective[name] = answers[name];
    }
    return (visible: result, ctx: effective);
  }

  String? _pageError(Map<String, dynamic> q, Map<String, dynamic> ctx) =>
      _errorForQuestion(q, answers[q['name']?.toString()], ctx);

  /// The question as rendered: cascade-filtered choices, piped label and
  /// hint, and (for visible calcs) the computed value to display.
  Map<String, dynamic> _displayQuestion(
      Map<String, dynamic> q, Map<String, dynamic> ctx) {
    final display = Map<String, dynamic>.from(_questionForDisplayIn(q, ctx));
    display['label'] = _pipe(display['label'] ?? display['name'], ctx);
    if (display['hint'] != null) {
      display['hint'] = _pipe(display['hint'], ctx);
    }
    if (_normalizeType(display['type']) == 'calculate') {
      display['_calc_value'] = ctx[display['name']?.toString()];
    }
    return display;
  }

  // ── build ──────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final computed = _computeVisible();
    final visible = computed.visible;
    final ctx = computed.ctx;
    final total = visible.length;
    // Pages: one per visible question + the review page at the end.
    final pageCount = total == 0 ? 0 : total + 1;

    // Answering a question can hide later ones; if the page we were on
    // no longer exists, snap back to the last valid page.
    if (pageCount > 0 && pageIndex >= pageCount) {
      pageIndex = pageCount - 1;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _pager.hasClients) _pager.jumpToPage(pageIndex);
      });
    }
    final onReview = total > 0 && pageIndex >= total;

    return PopScope(
      canPop: !_dirty,
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
                          final err = _pageError(visible[pageIndex], ctx);
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
                            errorFor: (q) => _pageError(q, ctx),
                            onJump: _jumpTo,
                          );
                        }
                        final sourceQuestion = visible[index];
                        final name = sourceQuestion['name'].toString();
                        final displayQuestion =
                            _displayQuestion(sourceQuestion, ctx);
                        return SingleChildScrollView(
                          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                          child: _QuestionCard(
                            key: ValueKey('q-$name'),
                            question: displayQuestion,
                            value: answers[name],
                            ctx: ctx,
                            controller: _controllerFor(sourceQuestion),
                            error: index == pageIndex ? inlineError : null,
                            warning:
                                _warnFor(sourceQuestion, answers[name], ctx),
                            onChanged: (value) {
                              setState(() {
                                answers[name] = value;
                                _dirty = true;
                                inlineError = null;
                              });
                            },
                          ),
                        );
                      },
                    ),
                  ),
                  _navBar(visible, ctx, total, onReview),
                ],
              ),
      ),
    );
  }

  Widget _counterBar(
      List<Map<String, dynamic>> visible, int total, bool onReview) {
    final answered = visible
        .where((q) => _hasValue(answers[q['name']?.toString()]))
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

  Widget _navBar(List<Map<String, dynamic>> visible,
      Map<String, dynamic> ctx, int total, bool onReview) {
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
                  _submit(visible, ctx);
                  return;
                }
                final err = _pageError(visible[pageIndex], ctx);
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
          final done = _hasValue(answers[q['name']?.toString()]);
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
            subtitle: (q['_group'] ?? '').toString().isEmpty
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

  // ── controllers ─────────────────────────────────────────────────────

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

  // ── save / submit ───────────────────────────────────────────────────

  void _submit(List<Map<String, dynamic>> visible, Map<String, dynamic> ctx) {
    for (var i = 0; i < visible.length; i++) {
      if (_pageError(visible[i], ctx) != null) {
        _jumpTo(i);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content:
                Text('Question ${i + 1} needs attention before submitting.')));
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

    // Drafts keep everything (so re-showing a question restores its old
    // answer), but a completed submission only includes answers to
    // questions that are relevant at submit time — Kobo behaviour. For
    // repeat groups the same rule applies per item: children hidden by
    // per-item skip logic are stripped, mirroring the server's
    // validate_submission cleaning pass. Calculated values are never
    // sent (the server recomputes and ignores client-sent calcs).
    final payload = Map<String, dynamic>.from(answers);
    if (status != 'draft') {
      final computed = _computeVisible();
      final relevantNames = computed.visible
          .where((q) => _normalizeType(q['type']) != 'calculate')
          .map((q) => q['name'].toString())
          .toSet();
      payload.removeWhere((name, _) => !relevantNames.contains(name));

      for (final q in computed.visible) {
        if (_normalizeType(q['type']) != 'repeat') continue;
        final name = q['name'].toString();
        final raw = payload[name];
        if (raw is! List) continue;
        final children = _childrenOf(q);
        final cleaned = <Map<String, dynamic>>[];
        for (final rawItem in raw) {
          final item = rawItem is Map
              ? Map<String, dynamic>.from(rawItem)
              : <String, dynamic>{};
          final ic = _itemContext(q, item, computed.ctx);
          final keep = <String, dynamic>{};
          for (final ch in children) {
            final ctype = _normalizeType(ch['type']);
            if (ctype == 'section' ||
                ctype == 'note' ||
                ctype == 'calculate') {
              continue;
            }
            final cname = ch['name']?.toString();
            if (cname == null || cname.isEmpty) continue;
            if (!LogicEvaluator(ic)(_conditionOf(ch))) continue;
            if (item.containsKey(cname)) keep[cname] = item[cname];
          }
          cleaned.add(keep);
        }
        payload[name] = cleaned;
      }
    }

    final submission = LocalSubmission(
      uuid: _submissionUuid,
      formCode: widget.form.code,
      version: widget.form.version,
      answers: payload,
      status: status,
      syncStatus: status == 'draft' ? 'draft' : 'pending',
      startedAt: startedAt,
      submittedAt: status == 'draft' ? null : now,
      durationMs: now.difference(startedAt).inMilliseconds,
      gpsLat: position?.latitude ?? widget.draft?.gpsLat,
      gpsLng: position?.longitude ?? widget.draft?.gpsLng,
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

class _QuestionCard extends StatelessWidget {
  final Map<String, dynamic> question; // display copy (piped, filtered)
  final dynamic value;
  final Map<String, dynamic> ctx;
  final ValueChanged<dynamic> onChanged;
  final TextEditingController? controller;
  final String? error;
  final String? warning;

  const _QuestionCard({
    super.key,
    required this.question,
    required this.value,
    required this.ctx,
    required this.onChanged,
    this.controller,
    this.error,
    this.warning,
  });

  @override
  Widget build(BuildContext context) {
    final q = question;
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
                _field(context, type, q),
                if (error != null) ...[
                  const SizedBox(height: 12),
                  _MessageBox.error(error!),
                ],
                if (error == null && warning != null) ...[
                  const SizedBox(height: 12),
                  _MessageBox.warning(warning!),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _field(BuildContext context, String type, Map<String, dynamic> q) {
    switch (type) {
      case 'note':
        return const SizedBox.shrink();

      case 'calculate':
        // A calc with visible:true — read-only live result, like the web
        // runner's calc-live card. Never blocks navigation.
        final out = q['_calc_value'];
        final text = out == null
            ? '—'
            : out is num
                ? _displayNumber((out * 100).roundToDouble() / 100)
                : out.toString();
        return Container(
          padding: const EdgeInsets.symmetric(vertical: 18),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: Theme.of(context)
                .colorScheme
                .primaryContainer
                .withOpacity(.35),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Text(text,
              style: Theme.of(context)
                  .textTheme
                  .headlineMedium
                  ?.copyWith(fontWeight: FontWeight.w900)),
        );

      case 'repeat':
        return _RepeatField(
          question: q,
          value: value,
          ctx: ctx,
          showErrors: error != null,
          onChanged: onChanged,
        );

      default:
        return _AnswerField(
          question: q,
          value: value,
          onChanged: onChanged,
          controller: controller,
        );
    }
  }
}

/// Small red/amber message strip used under fields.
class _MessageBox extends StatelessWidget {
  final String text;
  final bool isError;

  const _MessageBox.error(this.text) : isError = true;
  const _MessageBox.warning(this.text) : isError = false;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final bg = isError ? scheme.errorContainer : const Color(0xFFFFF3D6);
    final fg = isError ? scheme.onErrorContainer : const Color(0xFF7A5A00);
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          Icon(
              isError
                  ? Icons.error_outline_rounded
                  : Icons.warning_amber_rounded,
              size: 18,
              color: fg),
          const SizedBox(width: 8),
          Expanded(child: Text(text, style: TextStyle(color: fg))),
        ],
      ),
    );
  }
}

// ── one input widget per canonical type ───────────────────────────────
//
// Shared by top-level question pages and repeat-group items. When a
// [controller] is supplied (top-level text questions) a TextField is
// used; otherwise text inputs are TextFormFields seeded from the current
// value — repeat items key this widget so add/remove recreates fields
// with the right initial text.

class _AnswerField extends StatefulWidget {
  final Map<String, dynamic> question;
  final dynamic value;
  final ValueChanged<dynamic> onChanged;
  final TextEditingController? controller;

  const _AnswerField({
    super.key,
    required this.question,
    required this.value,
    required this.onChanged,
    this.controller,
  });

  @override
  State<_AnswerField> createState() => _AnswerFieldState();
}

class _AnswerFieldState extends State<_AnswerField> {
  bool _busyGps = false;

  @override
  Widget build(BuildContext context) {
    return _field(_normalizeType(widget.question['type']), widget.question);
  }

  /// TextField when a persistent controller is provided, TextFormField
  /// (seeded from the value) otherwise — so repeat children keep their
  /// text without the screen having to manage controllers per item.
  Widget _textInput({
    required String hint,
    IconData? icon,
    TextInputType? keyboardType,
    List<TextInputFormatter>? formatters,
    int minLines = 1,
    int maxLines = 1,
    TextCapitalization capitalization = TextCapitalization.none,
    bool autocorrect = true,
    required ValueChanged<String> onChanged,
  }) {
    final decoration = _decor(hint, prefixIcon: icon);
    if (widget.controller != null) {
      return TextField(
        controller: widget.controller,
        keyboardType: keyboardType,
        inputFormatters: formatters,
        minLines: minLines == 1 ? null : minLines,
        maxLines: maxLines,
        textCapitalization: capitalization,
        autocorrect: autocorrect,
        decoration: decoration,
        onChanged: onChanged,
      );
    }
    return TextFormField(
      initialValue: widget.value?.toString() ?? '',
      keyboardType: keyboardType,
      inputFormatters: formatters,
      minLines: minLines == 1 ? null : minLines,
      maxLines: maxLines,
      textCapitalization: capitalization,
      autocorrect: autocorrect,
      decoration: decoration,
      onChanged: onChanged,
    );
  }

  Widget _field(String type, Map<String, dynamic> q) {
    switch (type) {
      case 'note': {
        return const SizedBox.shrink();
      }

      case 'integer': {
        return _textInput(
          hint: 'Enter a whole number',
          icon: Icons.numbers_rounded,
          keyboardType: const TextInputType.numberWithOptions(signed: true),
          formatters: [FilteringTextInputFormatter.allow(RegExp(r'^-?\d*'))],
          onChanged: (value) => widget.onChanged(int.tryParse(value)),
        );
      }

      case 'decimal': {
        return _textInput(
          hint: 'Enter a number',
          icon: Icons.numbers_rounded,
          keyboardType: const TextInputType.numberWithOptions(
              signed: true, decimal: true),
          formatters: [
            FilteringTextInputFormatter.allow(RegExp(r'^-?\d*\.?\d*')),
          ],
          onChanged: (value) => widget.onChanged(double.tryParse(value)),
        );
      }

      case 'phone': {
        return _textInput(
          hint: 'Enter phone number',
          icon: Icons.call_rounded,
          keyboardType: TextInputType.phone,
          formatters: [
            FilteringTextInputFormatter.allow(RegExp(r'^[+\d\s-]*')),
          ],
          onChanged: widget.onChanged,
        );
      }

      case 'email': {
        return _textInput(
          hint: 'name@example.com',
          icon: Icons.alternate_email_rounded,
          keyboardType: TextInputType.emailAddress,
          autocorrect: false,
          onChanged: widget.onChanged,
        );
      }

      case 'textarea': {
        return _textInput(
          hint: 'Enter response',
          minLines: 4,
          maxLines: 10,
          capitalization: TextCapitalization.sentences,
          onChanged: widget.onChanged,
        );
      }

      case 'select_one': {
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
      }

      case 'select_many': {
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
      }

      case 'rank': {
        // Order the options with ↑/↓, exactly like the web runner. The
        // default (unmoved) order still counts as an answer, so it is
        // committed once the question is first shown.
        final choices = _choices(q);
        final allowedVals = choices.map((c) => c.$1).toList();
        final current = <String>[];
        if (widget.value is List) {
          for (final v in (widget.value as List)) {
            final s = v.toString();
            if (allowedVals.contains(s) && !current.contains(s)) {
              current.add(s);
            }
          }
        }
        for (final v in allowedVals) {
          if (!current.contains(v)) current.add(v);
        }
        if (widget.value == null && allowedVals.isNotEmpty) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) widget.onChanged(List<String>.from(current));
          });
        }
        String labelOf(String v) {
          for (final c in choices) {
            if (c.$1 == v) return c.$2;
          }
          return v;
        }

        return Column(
          children: List.generate(current.length, (i) {
            void move(int delta) {
              final j = i + delta;
              if (j < 0 || j >= current.length) return;
              final next = List<String>.from(current);
              final tmp = next[i];
              next[i] = next[j];
              next[j] = tmp;
              widget.onChanged(next);
            }

            return _choiceTile(
              selected: false,
              child: ListTile(
                dense: true,
                leading: CircleAvatar(
                    radius: 14,
                    child: Text('${i + 1}',
                        style: const TextStyle(
                            fontSize: 13, fontWeight: FontWeight.w800))),
                title: Text(labelOf(current[i])),
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    IconButton(
                      icon: const Icon(Icons.arrow_upward_rounded, size: 20),
                      onPressed: i == 0 ? null : () => move(-1),
                    ),
                    IconButton(
                      icon:
                          const Icon(Icons.arrow_downward_rounded, size: 20),
                      onPressed:
                          i == current.length - 1 ? null : () => move(1),
                    ),
                  ],
                ),
              ),
            );
          }),
        );
      }

      case 'yesno': {
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
      }

      case 'rating': {
        final max =
            int.tryParse(_questionSetting(q, 'max')?.toString() ?? '') ?? 5;
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
      }

      case 'scale': {
        final min =
            double.tryParse(_questionSetting(q, 'min')?.toString() ?? '') ?? 0;
        final max =
            double.tryParse(_questionSetting(q, 'max')?.toString() ?? '') ??
                10;
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
      }

      case 'likert': {
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
      }

      case 'date': {
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
      }

      case 'time': {
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
      }

      case 'datetime': {
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
      }

      case 'gps': {
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
      }

      case 'photo': {
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
      }

      case 'barcode': {
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
      }

      case 'signature': {
        final captured = widget.value != null;
        return FilledButton.tonalIcon(
          icon: Icon(captured
              ? Icons.check_circle_rounded
              : Icons.draw_rounded),
          label:
              Text(captured ? 'Signature captured — redo' : 'Capture signature'),
          onPressed: _captureSignature,
        );
      }

      default: { // 'text' and anything unknown
        return _textInput(
          hint: 'Enter response',
          capitalization: TextCapitalization.sentences,
          onChanged: widget.onChanged,
        );
      }
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

// ── repeat group field ────────────────────────────────────────────────
//
// KoboCollect-style roster on a single page: one card per item, each
// rendering the group's children with the item's own context (sibling
// answers shadow outer ones, per-item calcs are live). Add/remove
// controls follow the bounds; a count_expr auto-sizes the list and hides
// the controls, exactly like the web runner's repeatHtml().

class _RepeatField extends StatelessWidget {
  final Map<String, dynamic> question;
  final dynamic value;

  /// Outer answer context (top-level answers + calcs).
  final Map<String, dynamic> ctx;

  /// When true (the page was blocked by Next/swipe), per-child errors
  /// are shown inline inside each item card.
  final bool showErrors;
  final ValueChanged<dynamic> onChanged;

  const _RepeatField({
    required this.question,
    required this.value,
    required this.ctx,
    required this.showErrors,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final rp = _repeatSpec(question);
    final bounds = _repeatBounds(rp, ctx);
    var items = _itemsOf(value);

    // count_expr fixes the item count: auto-size the stored answer to
    // match (pad with empty items / truncate extras) and re-commit it.
    if (bounds.exact != null && items.length != bounds.exact) {
      items = List<Map<String, dynamic>>.from(items);
      while (items.length < bounds.exact!) {
        items.add(<String, dynamic>{});
      }
      if (items.length > bounds.exact!) {
        items.removeRange(bounds.exact!, items.length);
      }
      final snapshot = [
        for (final item in items) Map<String, dynamic>.from(item)
      ];
      WidgetsBinding.instance.addPostFrameCallback((_) {
        onChanged(snapshot);
      });
    }

    final scheme = Theme.of(context).colorScheme;
    final children = _childrenOf(question);
    final fixedCount = bounds.exact != null;
    final canAdd = !fixedCount &&
        (bounds.hi == null || items.length < bounds.hi!);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (items.isEmpty)
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Theme.of(context).dividerColor),
            ),
            child: Text(
              fixedCount
                  ? 'Answer the controlling question (${rp['count_expr']}) to add items here.'
                  : 'No items yet — tap the button below to add the first one.',
              style: TextStyle(color: scheme.onSurfaceVariant),
            ),
          ),
        for (var idx = 0; idx < items.length; idx++)
          _itemCard(context, items, idx, children, rp, fixedCount),
        const SizedBox(height: 8),
        if (canAdd)
          OutlinedButton.icon(
            icon: const Icon(Icons.add_rounded),
            label: Text((rp['add_label'] ??
                    'Add ${question['item_noun'] ?? 'item'}')
                .toString()),
            onPressed: () => onChanged([
              for (final item in items) Map<String, dynamic>.from(item),
              <String, dynamic>{},
            ]),
          ),
        if (fixedCount)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              '${bounds.exact} item(s), set by the form (${rp['count_expr']}).',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          )
        else if (bounds.lo != null || bounds.hi != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              [
                if (bounds.lo != null) 'Minimum ${bounds.lo!.toInt()}',
                if (bounds.hi != null) 'Maximum ${bounds.hi!.toInt()}',
              ].join(', '),
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
      ],
    );
  }

  Widget _itemCard(
    BuildContext context,
    List<Map<String, dynamic>> items,
    int idx,
    List<Map<String, dynamic>> children,
    Map<String, dynamic> rp,
    bool fixedCount,
  ) {
    final scheme = Theme.of(context).colorScheme;
    final item = items[idx];
    final ic = _itemContext(question, item, ctx);
    final label = _itemLabel(rp, idx, ic);

    final blocks = <Widget>[];
    for (final ch in children) {
      final ctype = _normalizeType(ch['type']);

      if (ctype == 'calculate') continue;

      if (ctype == 'section') {
        blocks.add(Padding(
          padding: const EdgeInsets.only(top: 12, bottom: 4),
          child: Text(
            _pipe(ch['label'] ?? ch['name'] ?? '', ic).toUpperCase(),
            style: TextStyle(
              color: scheme.primary,
              fontWeight: FontWeight.w800,
              fontSize: 11,
              letterSpacing: 1.1,
            ),
          ),
        ));
        continue;
      }

      final relevant = LogicEvaluator(ic)(_conditionOf(ch));
      if (!relevant) continue;

      if (ctype == 'note') {
        blocks.add(Container(
          margin: const EdgeInsets.only(top: 10),
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: scheme.surfaceContainerHighest.withOpacity(.5),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('🛈 ${_pipe(ch['label'] ?? '', ic)}',
                  style: const TextStyle(fontWeight: FontWeight.w700)),
              if ((ch['hint'] ?? '').toString().isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(_pipe(ch['hint'], ic),
                      style: TextStyle(color: scheme.onSurfaceVariant)),
                ),
            ],
          ),
        ));
        continue;
      }

      final cname = ch['name']?.toString();
      if (cname == null || cname.isEmpty) continue;

      final cval = item[cname];
      final display = Map<String, dynamic>.from(_questionForDisplayIn(ch, ic));
      final childLabel = _pipe(display['label'] ?? cname, ic);
      final childHint = _pipe(display['hint'], ic);
      final requiredChild = ch['required'] == true;

      String? err;
      if (showErrors) {
        if (requiredChild && !_hasValue(cval)) {
          final custom =
              _validationMap(ch)['message'] ?? ch['required_message'];
          final text = custom?.toString().trim();
          err = (text == null || text.isEmpty)
              ? 'This answer is required.'
              : text;
        } else if (_hasValue(cval)) {
          err = _errorForQuestion(ch, cval, ic);
        }
      }
      final warn = err == null ? _warnFor(ch, cval, ic) : null;

      blocks.add(Padding(
        padding: const EdgeInsets.only(top: 14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text.rich(
              TextSpan(
                text: childLabel,
                children: requiredChild
                    ? [
                        TextSpan(
                            text: ' *',
                            style: TextStyle(color: scheme.error))
                      ]
                    : [],
              ),
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            if (childHint.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(childHint,
                    style: TextStyle(
                        color: scheme.onSurfaceVariant, fontSize: 13)),
              ),
            const SizedBox(height: 8),
            _AnswerField(
              // Keying on group/index/name/count recreates text fields
              // with the right initial value when items shift after an
              // add/remove — while typing keeps state (same key).
              key: ValueKey(
                  'r|${question['name']}|$idx|$cname|${items.length}'),
              question: display,
              value: cval,
              onChanged: (v) => _setChild(items, idx, cname, v),
            ),
            if (err != null) ...[
              const SizedBox(height: 8),
              _MessageBox.error(err),
            ],
            if (err == null && warn != null) ...[
              const SizedBox(height: 8),
              _MessageBox.warning(warn),
            ],
          ],
        ),
      ));
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Theme.of(context).dividerColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.fromLTRB(14, 8, 6, 8),
            decoration: BoxDecoration(
              color: scheme.secondaryContainer.withOpacity(.6),
              borderRadius:
                  const BorderRadius.vertical(top: Radius.circular(13)),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(label,
                      style: const TextStyle(fontWeight: FontWeight.w800)),
                ),
                if (!fixedCount)
                  IconButton(
                    tooltip: 'Remove this item',
                    visualDensity: VisualDensity.compact,
                    icon: Icon(Icons.close_rounded,
                        size: 20, color: scheme.error),
                    onPressed: () => _confirmRemove(context, items, idx),
                  ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: blocks,
            ),
          ),
        ],
      ),
    );
  }

  void _setChild(
      List<Map<String, dynamic>> items, int idx, String name, dynamic v) {
    final next = [
      for (final item in items) Map<String, dynamic>.from(item)
    ];
    next[idx][name] = v;
    onChanged(next);
  }

  Future<void> _confirmRemove(
      BuildContext context, List<Map<String, dynamic>> items, int idx) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Remove this item?'),
        content: const Text('Its answers will be removed from this group.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(
                backgroundColor:
                    Theme.of(dialogContext).colorScheme.error),
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      final next = [
        for (var i = 0; i < items.length; i++)
          if (i != idx) Map<String, dynamic>.from(items[i])
      ];
      onChanged(next);
    }
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
    if (type == 'repeat') {
      final count = value is List ? value.length : 0;
      return count == 0 ? '—' : '$count item${count == 1 ? '' : 's'}';
    }
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
          final type = _normalizeType(q['type']);
          if (type == 'note' || type == 'calculate') {
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
