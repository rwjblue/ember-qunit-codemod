import { moduleFor, test } from 'ember-qunit';

moduleFor('service:foo-bar', 'Unit | Service | FooBar', {
});

test('it exists', function(assert) {
  this.inject.service('foo');
  this.inject.service('foo', { as: 'bar' });
});

test('it works for controllers', function(assert) {
  this.inject.controller('foo');
  this.inject.controller('foo', { as: 'bar' });
});

test('handles dasherized names', function(assert) {
  this.inject.service('foo-bar');
});

test('handle cuted (long) services names', function(assert) {
  this.inject.service('foo-bar-with-a' +
    '-very-long-name');
  this.inject.service('foo-bar-with-a' +
    '-very-long-name', { as: 'foo-bar-with-a' +
      '-very-long-name' });
});

test('handle cuted (long) controllers names', function(assert) {
  this.inject.controller('foo-bar-with-a' +
    '-very-long-name');
  this.inject.controller('foo-bar-with-a' +
    '-very-long-name', { as: 'foo-bar-with-a' +
      '-very-long-name' });
});
