/// Turns an HTML mail body into readable plain text for the reader and for search.
String htmlToText(String html) {
  var s = html;
  s = s.replaceAll(RegExp(r'<(script|style|head)[^>]*>[\s\S]*?</\1>', caseSensitive: false), '');
  s = s.replaceAll(RegExp(r'<br\s*/?>', caseSensitive: false), '\n');
  s = s.replaceAll(RegExp(r'</(p|div|tr|h[1-6]|li|blockquote)>', caseSensitive: false), '\n');
  s = s.replaceAll(RegExp(r'<li[^>]*>', caseSensitive: false), '• ');
  s = s.replaceAllMapped(RegExp(r'<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)</a>', caseSensitive: false), (m) {
    final text = m.group(2)!.replaceAll(RegExp(r'<[^>]+>'), '').trim();
    final href = m.group(1)!;
    return text.isEmpty || text == href || href.startsWith('mailto:') ? text : '$text ($href)';
  });
  s = s.replaceAll(RegExp(r'<[^>]+>'), '');
  const entities = {
    '&nbsp;': ' ',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&rsquo;': '’',
    '&lsquo;': '‘',
    '&rdquo;': '”',
    '&ldquo;': '“',
    '&mdash;': '—',
    '&ndash;': '–',
    '&hellip;': '…',
  };
  entities.forEach((k, v) => s = s.replaceAll(k, v));
  s = s.replaceAllMapped(RegExp(r'&#(x?)([0-9a-fA-F]+);'), (m) {
    final code = int.tryParse(m.group(2)!, radix: m.group(1)!.isEmpty ? 10 : 16);
    return code == null ? '' : String.fromCharCode(code);
  });
  s = s.replaceAll('&amp;', '&'); // last, so "&amp;lt;" stays "&lt;"
  s = s.replaceAll(RegExp(r'[ \t]+\n'), '\n').replaceAll(RegExp(r'\n{3,}'), '\n\n');
  return s.trim();
}
