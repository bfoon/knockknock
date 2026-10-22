import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/services/sync_engine.dart';
import '../forms/forms_screen.dart';
import '../settings/settings_screen.dart';
import '../submissions/submissions_screen.dart';
import '../sync/sync_center.dart';
import 'overview_screen.dart';

class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int index = 0;

  final screens = const [
    OverviewScreen(),
    FormsScreen(),
    SubmissionsScreen(),
    SettingsScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    final engine = context.watch<SyncEngine>();
    final waiting = engine.waiting + engine.rejected;
    return Scaffold(
      body: Column(
        children: [
          // Always-visible sync status (tap → Sync Center).
          const SyncStatusBar(),
          Expanded(
            // The status bar already handles the top inset; stop the tab
            // screens' AppBars from adding it a second time.
            child: MediaQuery.removePadding(
              context: context,
              removeTop: true,
              child: IndexedStack(index: index, children: screens),
            ),
          ),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (value) => setState(() => index = value),
        destinations: [
          const NavigationDestination(
              icon: Icon(Icons.dashboard_outlined),
              selectedIcon: Icon(Icons.dashboard_rounded),
              label: 'Home'),
          const NavigationDestination(
              icon: Icon(Icons.assignment_outlined),
              selectedIcon: Icon(Icons.assignment_rounded),
              label: 'Forms'),
          NavigationDestination(
              icon: Badge(
                isLabelVisible: waiting > 0,
                backgroundColor: engine.rejected > 0 ? Theme.of(context).colorScheme.error : null,
                label: Text('$waiting'),
                child: const Icon(Icons.sync_alt_outlined),
              ),
              selectedIcon: Badge(
                isLabelVisible: waiting > 0,
                backgroundColor: engine.rejected > 0 ? Theme.of(context).colorScheme.error : null,
                label: Text('$waiting'),
                child: const Icon(Icons.sync_alt_rounded),
              ),
              label: 'Records'),
          const NavigationDestination(
              icon: Icon(Icons.settings_outlined),
              selectedIcon: Icon(Icons.settings_rounded),
              label: 'Settings'),
        ],
      ),
    );
  }
}
