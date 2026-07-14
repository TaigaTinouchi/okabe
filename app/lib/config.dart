/// 接続設定。ビルド時の --dart-define で注入する。
///
/// 例:
///   flutter run -d macos \
///     --dart-define=AGENT_URL=http://localhost:8787 \
///     --dart-define=AGENT_TOKEN=`AUTH_TOKEN と同じ値`
class AppConfig {
  const AppConfig({required this.baseUri, required this.token});

  factory AppConfig.fromEnvironment() {
    return AppConfig(
      baseUri: Uri.parse(
        const String.fromEnvironment(
          'AGENT_URL',
          defaultValue: 'http://localhost:8787',
        ),
      ),
      token: const String.fromEnvironment('AGENT_TOKEN'),
    );
  }

  final Uri baseUri;
  final String token;

  Uri get wsUri => baseUri.replace(
        scheme: baseUri.scheme == 'https' ? 'wss' : 'ws',
        path: '/ws',
      );

  Uri eventsUri({required int after}) =>
      baseUri.replace(path: '/events', queryParameters: {'after': '$after'});

  Uri get readCursorUri => baseUri.replace(path: '/read-cursor');

  Map<String, String> get authHeaders => {'authorization': 'Bearer $token'};
}
