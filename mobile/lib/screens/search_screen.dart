import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../data/models.dart';
import '../services/mailbox.dart';
import '../widgets/message_tile.dart';
import 'reader_screen.dart';

/// Searches the mail stored on the phone, inside the active session only. Works offline.
class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key});

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  final controller = TextEditingController();
  List<Message> results = const [];
  Timer? _debounce;
  String _last = '';

  void _run(String query) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 200), () async {
      final found = await context.read<Mailbox>().search(query);
      if (!mounted) return;
      setState(() {
        results = found;
        _last = query;
      });
    });
  }

  @override
  void dispose() {
    _debounce?.cancel();
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final mail = context.watch<Mailbox>();
    return Scaffold(
      appBar: AppBar(
        title: TextField(
          controller: controller,
          autofocus: true,
          textInputAction: TextInputAction.search,
          decoration: InputDecoration(hintText: 'Search ${mail.activeSession!.name} mail', border: InputBorder.none),
          onChanged: _run,
        ),
      ),
      body: results.isEmpty
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Text(
                  _last.trim().isEmpty ? 'Searches subject, people and message text saved on this phone. Works offline.' : 'No matches for “$_last”.',
                  textAlign: TextAlign.center,
                ),
              ),
            )
          : ListView.separated(
              itemCount: results.length,
              separatorBuilder: (_, _) => const Divider(height: 1, indent: 64),
              itemBuilder: (context, index) {
                final m = results[index];
                return MessageTile(
                  message: m,
                  showAccount: mail.accounts.length > 1,
                  onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ReaderScreen(messageId: m.id))),
                );
              },
            ),
    );
  }
}
