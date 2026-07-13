import 'dart:convert';

/// サーバー発イベント。server/src/protocol.ts の serverEventSchema と対応する。
class ServerEvent {
  const ServerEvent({
    required this.id,
    required this.type,
    required this.ts,
    required this.text,
  });

  final int id;
  final String type;
  final String ts;
  final String text;

  bool get isUser => type == 'user_message';
  bool get isNotification => type == 'notification';

  /// 1 WebSocket フレーム / catch-up の1要素をパースする。
  /// 永続イベントでないもの（一時 error 等）や未知の形は null。
  static ServerEvent? tryParse(Object? raw) {
    final Object? json;
    if (raw is String) {
      try {
        json = jsonDecode(raw);
      } on FormatException {
        return null;
      }
    } else {
      json = raw;
    }
    if (json is! Map<String, dynamic>) return null;
    final id = json['id'];
    final type = json['type'];
    final ts = json['ts'];
    final payload = json['payload'];
    if (id is! int || type is! String || ts is! String) return null;
    if (payload is! Map<String, dynamic> || payload['text'] is! String) {
      return null;
    }
    return ServerEvent(
      id: id,
      type: type,
      ts: ts,
      text: payload['text'] as String,
    );
  }
}

String encodeUserMessage(String text) => jsonEncode({
      'type': 'user_message',
      'payload': {'text': text},
    });

/// assistant_delta（ストリーミング断片・非永続）の断片テキストを返す。違えば null。
String? tryParseAssistantDelta(Object? raw) {
  if (raw is! String) return null;
  final Object? json;
  try {
    json = jsonDecode(raw);
  } on FormatException {
    return null;
  }
  if (json is! Map<String, dynamic>) return null;
  if (json['type'] != 'assistant_delta') return null;
  final payload = json['payload'];
  if (payload is! Map<String, dynamic>) return null;
  final text = payload['text'];
  return text is String ? text : null;
}
