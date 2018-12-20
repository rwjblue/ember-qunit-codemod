import { module, test } from 'qunit';
import { setupTest } from 'ember-qunit';
import { withMoar } from 'foo-bar';

module('Acceptance | foo-bar', function () {
  setupTest();

  function tests() {
    test('test one', function() {});
    test('test two', function() {});
  }

  tests();
  module('[moar enabled]', withMoar(tests)); // This should stay the same
});