import 'package:flutter/material.dart';

import 'screens/inbox_screen.dart';

class PosoApp extends StatelessWidget {
  const PosoApp({super.key});

  static const seed = Color(0xFF4F46E5);

  ThemeData _theme(Brightness brightness) {
    final scheme = ColorScheme.fromSeed(seedColor: seed, brightness: brightness);
    return ThemeData(
      colorScheme: scheme,
      useMaterial3: true,
      visualDensity: VisualDensity.standard,
      listTileTheme: const ListTileThemeData(contentPadding: EdgeInsets.symmetric(horizontal: 16)),
      inputDecorationTheme: const InputDecorationTheme(border: OutlineInputBorder()),
    );
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Poso',
      debugShowCheckedModeBanner: false,
      theme: _theme(Brightness.light),
      darkTheme: _theme(Brightness.dark),
      home: const InboxScreen(),
    );
  }
}

Color hexColor(String hex, [Color fallback = PosoApp.seed]) {
  final value = int.tryParse(hex.replaceFirst('#', ''), radix: 16);
  if (value == null) return fallback;
  return Color(hex.length <= 7 ? 0xFF000000 | value : value);
}
