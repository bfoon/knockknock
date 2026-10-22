import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:workmanager/workmanager.dart';

import 'app.dart';
import 'core/database/app_database.dart';
import 'core/services/api_client.dart';
import 'core/services/live_stream_service.dart';
import 'core/services/sync_engine.dart';
import 'core/services/sync_service.dart';
import 'core/services/sync_settings.dart';
import 'features/auth/auth_controller.dart';
import 'features/forms/forms_controller.dart';
import 'features/submissions/submissions_controller.dart';

@pragma('vm:entry-point')
void callbackDispatcher() {
  Workmanager().executeTask((task, inputData) async {
    WidgetsFlutterBinding.ensureInitialized();

    final database = AppDatabase();

    try {
      await database.initialize();

      final settings = await SyncSettings.load();
      final api = ApiClient();

      // Live GPS batches that were queued offline, oldest first.
      LiveStreamService.instance
          .configure(database, api: api, settings: () => settings);
      await LiveStreamService.instance.flushQueue();

      // Background sync respects the user's auto-sync / Wi-Fi-only choice
      // (Workmanager already waits for a network; Wi-Fi-only is enforced
      // by the constraint registered in main()).
      if (settings.autoSync) {
        await SyncService(database: database, api: api).run();
      }

      return true;
    } catch (error, stackTrace) {
      debugPrint('Background synchronization failed: $error');
      debugPrintStack(stackTrace: stackTrace);

      return false;
    }
  });
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await Workmanager().initialize(
    callbackDispatcher,
  );

  final database = AppDatabase();
  await database.initialize();

  // Background sync every 15 min (Android's minimum). On Wi-Fi-only, the OS
  // only runs it on an unmetered network. `update` re-applies the
  // constraint when the setting changed since the last launch.
  final syncSettings = await SyncSettings.load();
  await Workmanager().registerPeriodicTask(
    'kura-auto-sync',
    'kura-auto-sync',
    frequency: const Duration(minutes: 15),
    constraints: Constraints(
      networkType: syncSettings.wifiOnly
          ? NetworkType.unmetered
          : NetworkType.connected,
    ),
    existingWorkPolicy: ExistingPeriodicWorkPolicy.update,
  );

  // Foreground automatic sync: on reconnect, after each finished form,
  // on resume and every minute while open.
  await SyncEngine.instance.start(database);

  runApp(
    MultiProvider(
      providers: [
        Provider<AppDatabase>.value(
          value: database,
        ),
        ChangeNotifierProvider<SyncEngine>.value(
          value: SyncEngine.instance,
        ),
        ChangeNotifierProvider<AuthController>(
          create: (_) => AuthController(database)..restoreSession(),
        ),
        ChangeNotifierProvider<FormsController>(
          create: (_) => FormsController(database),
        ),
        ChangeNotifierProvider<SubmissionsController>(
          create: (_) => SubmissionsController(database)..load(),
        ),
      ],
      child: const KuraCollectApp(),
    ),
  );
}