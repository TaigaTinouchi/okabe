import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:okabe_app/agent_client.dart';
import 'package:okabe_app/chat_screen.dart';
import 'package:okabe_app/protocol.dart';
import 'package:okabe_app/providers.dart';

class FakeAgentConnection implements AgentConnection {
  final eventsController = StreamController<ServerEvent>.broadcast();
  final deltasController = StreamController<String>.broadcast();
  final statusController = StreamController<ConnectionStatus>.broadcast();
  final sent = <String>[];

  @override
  Stream<ServerEvent> get events => eventsController.stream;

  @override
  Stream<String> get assistantDeltas => deltasController.stream;

  @override
  Stream<ConnectionStatus> get statusChanges => statusController.stream;

  @override
  ConnectionStatus status = ConnectionStatus.connected;

  @override
  void start() {}

  @override
  void send(String text) => sent.add(text);

  @override
  void dispose() {}
}

void main() {
  late FakeAgentConnection fake;

  Widget wrap() {
    fake = FakeAgentConnection();
    return ProviderScope(
      overrides: [agentConnectionProvider.overrideWithValue(fake)],
      child: const MaterialApp(home: ChatScreen()),
    );
  }

  testWidgets('受信イベントがタイムラインに表示される', (tester) async {
    await tester.pumpWidget(wrap());
    fake.statusController.add(ConnectionStatus.connected);
    fake.eventsController.add(const ServerEvent(
      id: 1,
      type: 'assistant_message',
      ts: '2026-07-13T09:00:00Z',
      text: 'echo: hi',
    ));
    await tester.pump();
    expect(find.text('echo: hi'), findsOneWidget);
  });

  testWidgets('通知イベントは通知ラベル付きで表示される', (tester) async {
    await tester.pumpWidget(wrap());
    fake.eventsController.add(const ServerEvent(
      id: 2,
      type: 'notification',
      ts: '2026-07-13T09:00:00Z',
      text: '今日の予定は2件です',
    ));
    await tester.pump();
    expect(find.text('今日の予定は2件です'), findsOneWidget);
    expect(find.text('通知'), findsOneWidget);
  });

  testWidgets('接続中は送信ボタンでメッセージが送られる', (tester) async {
    await tester.pumpWidget(wrap());
    fake.statusController.add(ConnectionStatus.connected);
    await tester.pump();

    await tester.enterText(find.byType(TextField), 'こんにちは');
    await tester.tap(find.byType(IconButton));
    expect(fake.sent, ['こんにちは']);
  });

  testWidgets('ストリーミング断片が生成途中バブルに累積表示され、確定で置換される',
      (tester) async {
    // Stream配送(microtask)と再描画で2フレームかかることがあるため pump を2回
    Future<void> pump2() async {
      await tester.pump();
      await tester.pump();
    }

    await tester.pumpWidget(wrap());
    fake.deltasController.add('こん');
    await pump2();
    expect(find.text('こん▌'), findsOneWidget);

    fake.deltasController.add('にちは');
    await pump2();
    expect(find.text('こんにちは▌'), findsOneWidget);

    // 確定イベントで pending が消え、通常バブルに置き換わる
    fake.eventsController.add(const ServerEvent(
      id: 1,
      type: 'assistant_message',
      ts: '2026-07-13T09:00:00Z',
      text: 'こんにちは',
    ));
    await pump2();
    expect(find.text('こんにちは▌'), findsNothing);
    expect(find.text('こんにちは'), findsOneWidget);
  });

  testWidgets('切断中は送信ボタンが無効', (tester) async {
    await tester.pumpWidget(wrap());
    fake.status = ConnectionStatus.disconnected;
    fake.statusController.add(ConnectionStatus.disconnected);
    await tester.pump();

    final button = tester.widget<IconButton>(find.byType(IconButton));
    expect(button.onPressed, isNull);
  });
}
