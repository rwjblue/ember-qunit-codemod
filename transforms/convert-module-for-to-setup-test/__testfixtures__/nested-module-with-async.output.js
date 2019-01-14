import { module, test } from 'qunit';
import { settled } from '@ember/test-helpers';

module('Integration | Component | FooBar', function() {
  test('absolute value works', async function(assert) {
    await settled();
    await click('.foo');
  });
});
