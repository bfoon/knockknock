import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../core/database/app_database.dart';
import '../../core/models/form_model.dart';
import '../../core/services/api_client.dart';

class FormsController extends ChangeNotifier {
  final AppDatabase database;
  final ApiClient _api = ApiClient();

  List<KuraForm> forms = [];
  bool loading = false;
  String? error;

  /// "Form X was approved" — shown once on the Forms screen.
  String? approvedNotice;
  Timer? _approvalWatch;

  FormsController(this.database) {
    // While any form is waiting for the supervisor's approval, re-check
    // every minute so it downloads by itself the moment it's approved —
    // no need for the enumerator to keep pulling to refresh.
    _approvalWatch = Timer.periodic(const Duration(minutes: 1), (_) {
      if (!loading && forms.any((f) => f.accessStatus == 'pending')) {
        refresh(silent: true);
      }
    });
  }

  int get pendingApproval => forms.where((f) => f.accessStatus == 'pending').length;

  void clearApprovedNotice() {
    approvedNotice = null;
    notifyListeners();
  }

  @override
  void dispose() {
    _approvalWatch?.cancel();
    super.dispose();
  }

  Future<void> loadLocal() async {
    forms = await database.getForms();
    notifyListeners();
  }

  /// [silent]: background re-check (no spinner, no error banner).
  Future<void> refresh({bool silent = false}) async {
    final wasPending = {
      for (final f in forms)
        if (f.accessStatus == 'pending') f.code: f.title
    };
    if (!silent) {
      loading = true;
      error = null;
      notifyListeners();
    }
    try {
      final remote = await _api.fetchManifest();
      for (final form in remote) {
        final local = await database.getForm(form.code);

        // A manifest contains metadata only. Always refresh the full schema
        // for approved forms while the phone is online; otherwise an older
        // schema can remain cached under a newer version/hash and newly
        // published skip logic will never reach the runner.
        if (form.allowed) {
          try {
            final downloaded = await _api.downloadForm(form.code);
            await database.upsertForm(
              KuraForm(
                code: downloaded.code,
                title: downloaded.title,
                description: downloaded.description,
                version: downloaded.version,
                schemaHash: downloaded.schemaHash,
                accessStatus: downloaded.accessStatus,
                allowed: downloaded.allowed,
                isOpen: downloaded.isOpen,
                schema: downloaded.schema,
                downloadedAt: DateTime.now(),
              ),
            );
            continue;
          } catch (_) {
            // Keep a genuinely current offline copy when the individual
            // download fails after the manifest request succeeded.
          }
        }

        final schemaIsCurrent = local != null &&
            local.version == form.version &&
            local.schemaHash == form.schemaHash;

        await database.upsertForm(
          KuraForm(
            code: form.code,
            title: form.title,
            description: form.description,
            version: form.version,
            schemaHash: form.schemaHash,
            accessStatus: form.accessStatus,
            allowed: form.allowed,
            isOpen: form.isOpen,
            schema: schemaIsCurrent ? local.schema : null,
            downloadedAt: schemaIsCurrent ? local.downloadedAt : null,
          ),
        );
      }
      forms = await database.getForms();
      final nowApproved = [
        for (final f in forms)
          if (wasPending.containsKey(f.code) && f.allowed) f.title
      ];
      if (nowApproved.isNotEmpty) {
        approvedNotice = nowApproved.length == 1
            ? '✅ "${nowApproved.first}" was approved — ready to fill.'
            : '✅ ${nowApproved.length} forms were approved — ready to fill.';
      }
    } catch (e) {
      if (!silent) {
        error = 'Unable to refresh forms. Offline forms remain available.';
      }
      forms = await database.getForms();
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<KuraForm?> addByCode(String code) async {
    loading = true;
    error = null;
    notifyListeners();
    try {
      final requested = await _api.requestForm(code);
      await database.upsertForm(requested);
      if (requested.allowed) {
        final downloaded = await _api.downloadForm(code);
        final saved = KuraForm(
          code: downloaded.code,
          title: downloaded.title,
          description: downloaded.description,
          version: downloaded.version,
          schemaHash: downloaded.schemaHash,
          accessStatus: downloaded.accessStatus,
          allowed: true,
          isOpen: downloaded.isOpen,
          schema: downloaded.schema,
          downloadedAt: DateTime.now(),
        );
        await database.upsertForm(saved);
      }
      forms = await database.getForms();
      return await database.getForm(code);
    } catch (e) {
      error = 'Form code could not be verified.';
      return null;
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<KuraForm?> download(String code) async {
    try {
      final remote = await _api.downloadForm(code);
      final saved = KuraForm(
        code: remote.code,
        title: remote.title,
        description: remote.description,
        version: remote.version,
        schemaHash: remote.schemaHash,
        accessStatus: remote.accessStatus,
        allowed: remote.allowed,
        isOpen: remote.isOpen,
        schema: remote.schema,
        downloadedAt: DateTime.now(),
      );
      await database.upsertForm(saved);
      forms = await database.getForms();
      notifyListeners();
      return saved;
    } catch (_) {
      return null;
    }
  }
}
