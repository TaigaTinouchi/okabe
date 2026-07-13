import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:http/http.dart' as http;
import 'package:web_socket_channel/io.dart';

import 'config.dart';
import 'protocol.dart';

enum ConnectionStatus { connecting, connected, disconnected }

/// エージェント接続の抽象。テストではフェイクに差し替える。
abstract class AgentConnection {
  Stream<ServerEvent> get events;

  /// アシスタント応答のストリーミング断片（非永続）。
  /// 確定文は [events] に assistant_message として流れてくる。
  Stream<String> get assistantDeltas;

  Stream<ConnectionStatus> get statusChanges;
  ConnectionStatus get status;
  void start();
  void send(String text);
  void dispose();
}

/// WebSocket 常時接続 + 再接続（指数バックオフ）+ catch-up（ADR-0003）。
///
/// イベントの真実はサーバーの受信箱にあるため、このクラスの責務は
/// 「切れたら繋ぎ直し、最終受信 id 以降を取り寄せ、id 順の重複なしストリームに直す」こと。
class AgentClient implements AgentConnection {
  AgentClient(this.config);

  final AppConfig config;

  final _events = StreamController<ServerEvent>.broadcast();
  final _deltas = StreamController<String>.broadcast();
  final _statusChanges = StreamController<ConnectionStatus>.broadcast();

  @override
  Stream<ServerEvent> get events => _events.stream;

  @override
  Stream<String> get assistantDeltas => _deltas.stream;

  @override
  Stream<ConnectionStatus> get statusChanges => _statusChanges.stream;

  @override
  ConnectionStatus status = ConnectionStatus.disconnected;

  IOWebSocketChannel? _channel;
  StreamSubscription<dynamic>? _subscription;
  Timer? _reconnectTimer;
  int _lastEventId = 0;
  int _retryCount = 0;
  bool _disposed = false;

  @override
  void start() {
    unawaited(_connect());
  }

  @override
  void send(String text) {
    _channel?.sink.add(encodeUserMessage(text));
  }

  Future<void> _connect() async {
    if (_disposed) return;
    _setStatus(ConnectionStatus.connecting);
    try {
      final channel = IOWebSocketChannel.connect(
        config.wsUri,
        headers: config.authHeaders,
        pingInterval: const Duration(seconds: 30),
        connectTimeout: const Duration(seconds: 10),
      );
      await channel.ready;
      _channel = channel;

      // WS 確立後に catch-up する。確立と取り寄せの隙間に届いたフレームは
      // いったんバッファし、_emit の id 重複排除で整流する。
      final buffered = <ServerEvent>[];
      var catchingUp = true;
      _subscription = channel.stream.listen(
        (frame) {
          final event = ServerEvent.tryParse(frame);
          if (event != null) {
            if (catchingUp) {
              buffered.add(event);
            } else {
              _emit(event);
            }
            return;
          }
          // ストリーミング断片は「今」表示する以外の価値がないので即時に流す
          final delta = tryParseAssistantDelta(frame);
          if (delta != null) _deltas.add(delta);
        },
        onDone: _scheduleReconnect,
        onError: (_) => _scheduleReconnect(),
      );

      final missed = await _fetchEventsAfter(_lastEventId);
      missed.forEach(_emit);
      buffered
        ..sort((a, b) => a.id.compareTo(b.id))
        ..forEach(_emit);
      catchingUp = false;

      _retryCount = 0;
      _setStatus(ConnectionStatus.connected);
    } on Exception {
      _scheduleReconnect();
    }
  }

  Future<List<ServerEvent>> _fetchEventsAfter(int after) async {
    final res = await http.get(
      config.eventsUri(after: after),
      headers: config.authHeaders,
    );
    if (res.statusCode != 200) {
      throw http.ClientException('catch-up failed: ${res.statusCode}');
    }
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    return (body['events'] as List<dynamic>)
        .map(ServerEvent.tryParse)
        .whereType<ServerEvent>()
        .toList();
  }

  void _emit(ServerEvent event) {
    if (event.id <= _lastEventId) return; // catch-up と WS の重複を排除
    _lastEventId = event.id;
    _events.add(event);
  }

  void _scheduleReconnect() {
    if (_disposed || _reconnectTimer != null) return;
    _teardownChannel();
    _setStatus(ConnectionStatus.disconnected);
    final delay = Duration(
      milliseconds: (1000 * pow(2, min(_retryCount, 5))).round(),
    );
    _retryCount++;
    _reconnectTimer = Timer(delay, () {
      _reconnectTimer = null;
      unawaited(_connect());
    });
  }

  void _teardownChannel() {
    _subscription?.cancel();
    _subscription = null;
    _channel?.sink.close();
    _channel = null;
  }

  void _setStatus(ConnectionStatus next) {
    if (status == next) return;
    status = next;
    _statusChanges.add(next);
  }

  @override
  void dispose() {
    _disposed = true;
    _reconnectTimer?.cancel();
    _teardownChannel();
    _events.close();
    _deltas.close();
    _statusChanges.close();
  }
}
