class ApiConfig {
  static const defaultBaseUrl = 'https://nokknock.app';

  static String normalizeBaseUrl(String value) {
    var url = value.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://$url';
    }
    while (url.endsWith('/')) {
      url = url.substring(0, url.length - 1);
    }
    return url;
  }

  static String deviceRegister(String baseUrl) =>
      '$baseUrl/kura/api/devices/register/';

  static String formAccess(String baseUrl) =>
      '$baseUrl/kura/api/forms/access/';

  static String manifest(String baseUrl) =>
      '$baseUrl/kura/api/forms/';

  static String formDetail(String baseUrl, String code) =>
      '$baseUrl/kura/api/forms/${code.toUpperCase()}/';

  static String lookups(String baseUrl, String code) =>
      '$baseUrl/kura/api/forms/${code.toUpperCase()}/lookups/';

  static String live(String baseUrl, String code) =>
      '$baseUrl/kura/api/forms/${code.toUpperCase()}/live/';

  static String sync(String baseUrl, String code) =>
      '$baseUrl/kura/api/forms/${code.toUpperCase()}/sync/';

  /// Photos for a record's answers (multipart: uuid, question, file).
  static String media(String baseUrl, String code) =>
      '$baseUrl/kura/api/forms/${code.toUpperCase()}/media/';

  /// "Which of these photos do you still need?" — skips re-uploads on retry.
  static String mediaCheck(String baseUrl, String code) =>
      '$baseUrl/kura/api/forms/${code.toUpperCase()}/media/check/';
}
