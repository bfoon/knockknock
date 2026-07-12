#!/usr/bin/env bash
set -euo pipefail

flutter clean
flutter pub get
flutter analyze
flutter test
flutter build apk --release

echo
echo "APK created at:"
echo "build/app/outputs/flutter-apk/app-release.apk"
