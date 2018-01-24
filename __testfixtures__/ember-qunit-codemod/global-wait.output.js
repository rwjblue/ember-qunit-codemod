import { module, test } from 'qunit';
import { setupApplicationTest } from 'ember-qunit';
import { visit } from '@ember/test-helpers';

module('something', function(hooks) {
  setupApplicationTest(hooks);

  test('uses global helpers', async function(assert) {
    await visit('/something');

    wait().then(() => assert.ok(true));
  });
});

