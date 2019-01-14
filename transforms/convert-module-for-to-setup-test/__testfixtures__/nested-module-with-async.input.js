import { module, test } from 'qunit';
import wait from 'ember-test-helpers/wait';

module('Integration | Component | FooBar');

test('absolute value works', function(assert) {
  return wait().then(() => {
    click('.foo');
  })
});
