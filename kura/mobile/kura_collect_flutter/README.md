# Kura Collect

A Flutter Android application for Kura mobile data collection.

## Core capabilities

- Device registration using Kura username and password
- Form discovery by QR scan or form code
- Per-device approval status
- Secure token storage
- Offline form storage
- Offline draft and completed submission storage
- Automatic synchronization when connectivity returns
- Manual synchronization
- Dynamic survey rendering
- Text, numeric, date, time, choice, multi-choice, GPS, photo and signature questions
- Local validation
- Submission retry and duplicate-safe UUID synchronization
- Professional dashboard and form library

## API routes expected

The app assumes the Django project exposes:

- `POST /kura/api/devices/register/`
- `POST /kura/api/forms/access/`
- `GET /kura/api/forms/`
- `GET /kura/api/forms/<code>/`
- `GET /kura/api/forms/<code>/lookups/`
- `POST /kura/api/forms/<code>/sync/`

These correspond to the supplied `kura/api.py`.

## Run

```bash
flutter pub get
flutter run
```

The login screen is preconfigured with:

```text
https://nokknock.app
```

## Android release

```bash
flutter build apk --release
```

For Play Store:

```bash
flutter build appbundle --release
```

## Required Django URL mapping

```python
path("api/devices/register/", api.device_register, name="api_device_register"),
path("api/forms/access/", api.form_access, name="api_form_access"),
path("api/forms/", api.forms_manifest, name="api_forms_manifest"),
path("api/forms/<str:code>/", api.form_detail, name="api_form_detail"),
path("api/forms/<str:code>/lookups/", api.form_lookups, name="api_form_lookups"),
path("api/forms/<str:code>/sync/", api.form_sync, name="api_form_sync"),
```

## Notes

Media answers are stored locally as file paths in this first release. The current supplied backend does not expose a media upload endpoint, so photo and signature files require a future upload endpoint before production use.


## Preconfigured production server

This package is configured to use:

    https://nokknock.app

The mobile API base is therefore:

    https://nokknock.app/kura/api/

## One-command release build

Linux/macOS:

    ./build_release.sh

Windows PowerShell:

    .\build_release.ps1
