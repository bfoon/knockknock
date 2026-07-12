$ErrorActionPreference = "Stop"

flutter clean
flutter pub get
flutter analyze
flutter test
flutter build apk --release

Write-Host ""
Write-Host "APK created at:"
Write-Host "build\app\outputs\flutter-apk\app-release.apk"
