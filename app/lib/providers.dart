import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'agent_client.dart';
import 'config.dart';
import 'protocol.dart';

final configProvider = Provider<AppConfig>((_) => AppConfig.fromEnvironment());

final agentConnectionProvider = Provider<AgentConnection>((ref) {
  final client = AgentClient(ref.watch(configProvider))..start();
  ref.onDispose(client.dispose);
  return client;
});

final connectionStatusProvider = StreamProvider<ConnectionStatus>(
  (ref) => ref.watch(agentConnectionProvider).statusChanges,
);

/// 受信イベントを時系列に積むタイムライン。
final timelineProvider = NotifierProvider<TimelineNotifier, List<ServerEvent>>(
  TimelineNotifier.new,
);

class TimelineNotifier extends Notifier<List<ServerEvent>> {
  @override
  List<ServerEvent> build() {
    final connection = ref.watch(agentConnectionProvider);
    final subscription =
        connection.events.listen((event) => state = [...state, event]);
    ref.onDispose(subscription.cancel);
    return [];
  }
}

/// 生成途中のアシスタント応答（assistant_delta の累積）。
/// 確定イベント（assistant_message）が届いたら消える。
final pendingAssistantProvider = NotifierProvider<PendingAssistantNotifier, String?>(
  PendingAssistantNotifier.new,
);

class PendingAssistantNotifier extends Notifier<String?> {
  @override
  String? build() {
    final connection = ref.watch(agentConnectionProvider);
    final deltaSub =
        connection.assistantDeltas.listen((text) => state = (state ?? '') + text);
    final eventSub = connection.events.listen((event) {
      if (!event.isUser) state = null;
    });
    ref.onDispose(deltaSub.cancel);
    ref.onDispose(eventSub.cancel);
    return null;
  }
}
