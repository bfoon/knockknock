import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:workmanager/workmanager.dart';

import 'app.dart';
import 'core/database/app_database.dart';
import 'core/services/api_client.dart';
import 'core/services/sync_service.dart';
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

      final syncService = SyncService(
        database: database,
        api: ApiClient(),
      );

      await syncService.syncAll();

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

  await Workmanager().registerPeriodicTask(
    'kura-auto-sync',
    'kura-auto-sync',
    frequency: const Duration(minutes: 15),
    constraints: Constraints(
      networkType: NetworkType.connected,
    ),
    existingWorkPolicy: ExistingWorkPolicy.keep,
  );

  final database = AppDatabase();
  await database.initialize();

  runApp(
    MultiProvider(
      providers: [
        Provider<AppDatabase>.value(
          value: database,
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