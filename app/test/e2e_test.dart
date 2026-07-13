/// 実サーバーとの E2E テスト。通常の `flutter test` ではスキップされる。
///
/// 実行方法（リポジトリルートで）:
///   1. `AUTH_TOKEN=(token) bun server/src/index.ts`（エコー確認なので ANTHROPIC_API_KEY なしで）
///   2. `cd app && fvm flutter test test/e2e_test.dart`
///      `--dart-define=E2E_AGENT_URL=http://localhost:8787 --dart-define=E2E_AGENT_TOKEN=(token)`
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:okabe_app/agent_client.dart';
import 'package:okabe_app/config.dart';
import 'package:okabe_app/protocol.dart';

void main() {
  const url = String.fromEnvironment('E2E_AGENT_URL');
  const token = String.fromEnvironment('E2E_AGENT_TOKEN');
  final skip = url.isEmpty ? 'E2E_AGENT_URL 未指定のためスキップ' : false;

  AgentClient makeClient() =>
      AgentClient(AppConfig(baseUri: Uri.parse(url), token: token))..start();

  test('往復: user_message を送るとタイムライン同報とエコーが返る', () async {
    final client = makeClient();
    final received = <ServerEvent>[];
    client.events.listen(received.add);
    await client.statusChanges
        .firstWhere((s) => s == ConnectionStatus.connected)
        .timeout(const Duration(seconds: 10));

    client.send('e2e ping');
    await _waitUntil(() =>
        received.any((e) => e.type == 'assistant_message' && e.text == 'echo: e2e ping'));
    expect(received.any((e) => e.isUser && e.text == 'e2e ping'), isTrue);
    client.dispose();
  }, skip: skip, timeout: const Timeout(Duration(seconds: 30)));

  test('catch-up: 新しいクライアントは過去のタイムラインを受け取る', () async {
    final client = makeClient();
    final received = <ServerEvent>[];
    client.events.listen(received.add);
    await _waitUntil(() => received.any((e) => e.text == 'echo: e2e ping'));
    client.dispose();
  }, skip: skip, timeout: const Timeout(Duration(seconds: 30)));
}

Future<void> _waitUntil(bool Function() predicate) async {
  final deadline = DateTime.now().add(const Duration(seconds: 10));
  while (!predicate()) {
    if (DateTime.now().isAfter(deadline)) {
      fail('条件が満たされる前にタイムアウトしました');
    }
    await Future<void>.delayed(const Duration(milliseconds: 50));
  }
}
