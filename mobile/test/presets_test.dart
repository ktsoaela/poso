import 'package:flutter_test/flutter_test.dart';
import 'package:poso/services/presets.dart';
import 'package:poso/services/transport.dart';

void main() {
  test('app passwords lose the spaces providers print', () {
    expect(mailPassword('gmail', 'abcd efgh ijkl mnop'), 'abcdefghijklmnop');
    expect(mailPassword('yahoo', 'abcd efgh ijkl mnop'), 'abcdefghijklmnop');
    expect(mailPassword('custom', 'my password'), 'my password');
  });

  test('PLAIN token matches RFC 4616', () {
    expect(imapPlainInitialResponse('tim', 'tanstaaftanstaaf'), 'AHRpbQB0YW5zdGFhZnRhbnN0YWFm');
  });
}
