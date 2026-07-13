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
  final statusController = StreamController<ConnectionStatus>.broadcast();
  final sent = <String>[];

  @override
  Stream<ServerEvent> get events => eventsController.stream;

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

  testWidgets('切断中は送信ボタンが無効', (tester) async {
    await tester.pumpWidget(wrap());
    fake.status = ConnectionStatus.disconnected;
    fake.statusController.add(ConnectionStatus.disconnected);
    await tester.pump();

    final button = tester.widget<IconButton>(find.byType(IconButton));
    expect(button.onPressed, isNull);
  });
}
