import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'auth_controller.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _server = TextEditingController(text: 'https://nokknock.app');
  final _username = TextEditingController();
  final _password = TextEditingController();
  final _device = TextEditingController(text: 'Kura Android');
  bool _obscure = true;

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Container(
                    width: 72,
                    height: 72,
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [Color(0xFF5B4BDB), Color(0xFFEF4F91)],
                      ),
                      borderRadius: BorderRadius.circular(24),
                    ),
                    child: const Icon(Icons.insights_rounded,
                        color: Colors.white, size: 38),
                  ),
                  const SizedBox(height: 24),
                  Text('Kura Collect',
                      style: Theme.of(context).textTheme.headlineLarge?.copyWith(
                            fontWeight: FontWeight.w800,
                          )),
                  const SizedBox(height: 8),
                  Text(
                    'Professional offline-first field data collection.',
                    style: Theme.of(context).textTheme.bodyLarge,
                  ),
                  const SizedBox(height: 28),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(20),
                      child: Form(
                        key: _formKey,
                        child: Column(
                          children: [
                            TextFormField(
                              controller: _server,
                              decoration: const InputDecoration(
                                labelText: 'Kura server',
                                prefixIcon: Icon(Icons.dns_rounded),
                                hintText: 'https://your-domain.com',
                              ),
                              validator: (value) => value == null ||
                                      value.trim().isEmpty
                                  ? 'Enter the Kura server address'
                                  : null,
                            ),
                            const SizedBox(height: 14),
                            TextFormField(
                              controller: _username,
                              decoration: const InputDecoration(
                                labelText: 'Username',
                                prefixIcon: Icon(Icons.person_outline),
                              ),
                              validator: (value) => value == null ||
                                      value.trim().isEmpty
                                  ? 'Enter your username'
                                  : null,
                            ),
                            const SizedBox(height: 14),
                            TextFormField(
                              controller: _password,
                              obscureText: _obscure,
                              decoration: InputDecoration(
                                labelText: 'Password',
                                prefixIcon: const Icon(Icons.lock_outline),
                                suffixIcon: IconButton(
                                  onPressed: () =>
                                      setState(() => _obscure = !_obscure),
                                  icon: Icon(_obscure
                                      ? Icons.visibility_outlined
                                      : Icons.visibility_off_outlined),
                                ),
                              ),
                              validator: (value) => value == null ||
                                      value.isEmpty
                                  ? 'Enter your password'
                                  : null,
                            ),
                            const SizedBox(height: 14),
                            TextFormField(
                              controller: _device,
                              decoration: const InputDecoration(
                                labelText: 'Device name',
                                prefixIcon: Icon(Icons.phone_android_rounded),
                              ),
                            ),
                            if (auth.error != null) ...[
                              const SizedBox(height: 12),
                              Text(auth.error!,
                                  style: TextStyle(
                                      color: Theme.of(context)
                                          .colorScheme
                                          .error)),
                            ],
                            const SizedBox(height: 20),
                            SizedBox(
                              width: double.infinity,
                              child: FilledButton.icon(
                                onPressed: auth.loading ? null : _submit,
                                icon: auth.loading
                                    ? const SizedBox.square(
                                        dimension: 18,
                                        child: CircularProgressIndicator(
                                            strokeWidth: 2))
                                    : const Icon(Icons.login_rounded),
                                label: const Padding(
                                  padding: EdgeInsets.symmetric(vertical: 14),
                                  child: Text('Register this device'),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    await context.read<AuthController>().login(
          baseUrl: _server.text,
          username: _username.text,
          password: _password.text,
          deviceName: _device.text,
        );
  }
}
