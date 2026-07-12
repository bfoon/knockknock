import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'core/theme/app_theme.dart';
import 'features/auth/auth_controller.dart';
import 'features/auth/login_screen.dart';
import 'features/home/home_shell.dart';

class KuraCollectApp extends StatelessWidget {
  const KuraCollectApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Kura Collect',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      themeMode: ThemeMode.system,
      home: Consumer<AuthController>(
        builder: (context, auth, _) {
          if (auth.loading) {
            return const Scaffold(
              body: Center(child: CircularProgressIndicator()),
            );
          }
          return auth.isAuthenticated ? const HomeShell() : const LoginScreen();
        },
      ),
    );
  }
}
