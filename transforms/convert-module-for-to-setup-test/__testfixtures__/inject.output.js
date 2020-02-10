import { module, test } from 'qunit';
import { setupTest } from 'ember-qunit';

module('Unit | Service | FooBar', function(hooks) {
  setupTest(hooks);

  test('it exists', function(assert) {
    this.foo = this.owner.lookup('service:foo');
    this.bar = this.owner.lookup('service:foo');
  });

  test('it works for controllers', function(assert) {
    this.foo = this.owner.lookup('controller:foo');
    this.bar = this.owner.lookup('controller:foo');
  });

  test('handles dasherized names', function(assert) {
    this['foo-bar'] = this.owner.lookup('service:foo-bar');
  });

  test('handle cuted (long) services names', function(assert) {
    this['foo-bar-with-a-very-long-name'] = this.owner.lookup('service:foo-bar-with-a-very-long-name');
    this['foo-bar-with-a-very-long-name'] = this.owner.lookup('service:foo-bar-with-a-very-long-name');
  });

  test('handle cuted (long) controllers names', function(assert) {
    this['foo-bar-with-a-very-long-name'] = this.owner.lookup('controller:foo-bar-with-a-very-long-name');
    this['foo-bar-with-a-very-long-name'] = this.owner.lookup('controller:foo-bar-with-a-very-long-name');
  });
});
