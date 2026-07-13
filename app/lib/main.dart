import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'chat_screen.dart';

void main() {
  runApp(const ProviderScope(child: OkabeApp()));
}

class OkabeApp extends StatelessWidget {
  const OkabeApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'okabe',
      theme: ThemeData(
        colorSchemeSeed: Colors.teal,
        brightness: Brightness.light,
      ),
      darkTheme: ThemeData(
        colorSchemeSeed: Colors.teal,
        brightness: Brightness.dark,
      ),
      home: const ChatScreen(),
    );
  }
}
