import 'package:intl/intl.dart';

String listDate(DateTime? date) {
  if (date == null) return '';
  final now = DateTime.now();
  if (date.year == now.year && date.month == now.month && date.day == now.day) return DateFormat.jm().format(date);
  if (now.difference(date).inDays < 6) return DateFormat.E().format(date);
  if (date.year == now.year) return DateFormat.MMMd().format(date);
  return DateFormat.yMMMd().format(date);
}

String fullDate(DateTime? date) => date == null ? '' : DateFormat.yMMMEd().add_jm().format(date);

String fileSize(int bytes) {
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(0)} KB';
  return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
}

String initials(String name, String email) {
  final source = name.trim().isNotEmpty ? name.trim() : email.split('@').first;
  final parts = source.split(RegExp(r'[\s._-]+')).where((p) => p.isNotEmpty).toList();
  if (parts.isEmpty) return '?';
  if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
  return (parts.first.substring(0, 1) + parts.last.substring(0, 1)).toUpperCase();
}
