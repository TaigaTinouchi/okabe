import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'agent_client.dart';
import 'protocol.dart';
import 'providers.dart';

class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key});

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _send() {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    ref.read(agentConnectionProvider).send(text);
    _controller.clear();
  }

  @override
  Widget build(BuildContext context) {
    final timeline = ref.watch(timelineProvider);
    final pending = ref.watch(pendingAssistantProvider);
    final status = ref
            .watch(connectionStatusProvider)
            .value ??
        ConnectionStatus.connecting;

    return Scaffold(
      appBar: AppBar(
        title: const Text('okabe'),
        actions: [_StatusIndicator(status: status)],
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView.builder(
              reverse: true,
              padding: const EdgeInsets.all(12),
              itemCount: timeline.length + (pending != null ? 1 : 0),
              itemBuilder: (context, index) {
                // reverse リストの先頭（画面の最下部）に生成途中のバブルを置く
                if (pending != null && index == 0) {
                  return _PendingBubble(text: pending);
                }
                final eventIndex =
                    timeline.length - 1 - (index - (pending != null ? 1 : 0));
                return _EventBubble(event: timeline[eventIndex]);
              },
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _controller,
                      decoration: const InputDecoration(
                        hintText: 'メッセージを送る',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                      onSubmitted: (_) => _send(),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    onPressed:
                        status == ConnectionStatus.connected ? _send : null,
                    icon: const Icon(Icons.arrow_upward),
                    tooltip: '送信',
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusIndicator extends StatelessWidget {
  const _StatusIndicator({required this.status});

  final ConnectionStatus status;

  @override
  Widget build(BuildContext context) {
    final (color, label) = switch (status) {
      ConnectionStatus.connected => (Colors.green, '接続中'),
      ConnectionStatus.connecting => (Colors.orange, '接続処理中'),
      ConnectionStatus.disconnected => (Colors.red, '切断'),
    };
    return Padding(
      padding: const EdgeInsets.only(right: 16),
      child: Row(
        children: [
          Icon(Icons.circle, size: 10, color: color),
          const SizedBox(width: 6),
          Text(label, style: Theme.of(context).textTheme.bodySmall),
        ],
      ),
    );
  }
}

/// 生成途中のアシスタント応答（assistant_delta の累積表示）
class _PendingBubble extends StatelessWidget {
  const _PendingBubble({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        constraints: const BoxConstraints(maxWidth: 480),
        decoration: BoxDecoration(
          color: scheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Text('$text▌'),
      ),
    );
  }
}

class _EventBubble extends StatelessWidget {
  const _EventBubble({required this.event});

  final ServerEvent event;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isUser = event.isUser;
    final background = isUser
        ? scheme.primaryContainer
        : event.isNotification
            ? scheme.tertiaryContainer
            : scheme.surfaceContainerHighest;

    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        constraints: const BoxConstraints(maxWidth: 480),
        decoration: BoxDecoration(
          color: background,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (event.isNotification)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.notifications_outlined,
                        size: 14, color: scheme.onTertiaryContainer),
                    const SizedBox(width: 4),
                    Text('通知', style: Theme.of(context).textTheme.labelSmall),
                  ],
                ),
              ),
            Text(event.text),
          ],
        ),
      ),
    );
  }
}
