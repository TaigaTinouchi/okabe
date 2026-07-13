import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:okabe_app/protocol.dart';

void main() {
  group('ServerEvent.tryParse', () {
    test('有効なイベントをパースする', () {
      final event = ServerEvent.tryParse(jsonEncode({
        'id': 42,
        'type': 'assistant_message',
        'ts': '2026-07-13T09:00:00Z',
        'payload': {'text': 'hello'},
      }));
      expect(event, isNotNull);
      expect(event!.id, 42);
      expect(event.type, 'assistant_message');
      expect(event.text, 'hello');
      expect(event.isUser, isFalse);
    });

    test('一時 error フレーム（id なし）は null', () {
      final event = ServerEvent.tryParse(jsonEncode({
        'type': 'error',
        'payload': {'message': 'invalid message'},
      }));
      expect(event, isNull);
    });

    test('JSON でない入力は null', () {
      expect(ServerEvent.tryParse('garbage'), isNull);
    });
  });

  test('encodeUserMessage はプロトコルのエンベロープを生成する', () {
    expect(jsonDecode(encodeUserMessage('やあ')), {
      'type': 'user_message',
      'payload': {'text': 'やあ'},
    });
  });
}
