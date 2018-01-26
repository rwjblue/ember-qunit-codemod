import { test } from 'ember-qunit';
import { test } from 'qunit';
import moduleForAcceptance from '../helpers/module-for-acceptance';
import { setupTestHelper } from 'setup-test-helper';

moduleForAcceptance('Acceptance | MyRoute', {
  beforeEach() {
    // my comment
    setupTestHelper();
  }
});

test('it happens', function() {
  visit('my-route');
  andThen(() => {
    assert.equal(currentURL(), 'wat');
  });
});

moduleForAcceptance('Acceptance | ES5 MyRoute', {
  beforeEach: function() {
    setupTestHelper();
  }
});

test('it happens with es5 function', function() {
  visit('my-route');
  andThen(() => {
    // visit me
    assert.equal(currentURL(), 'wat');
    assert.equal(currentURL(), 'wat');
    assert.equal(currentRouteName(), 'wat');
  });
});

moduleForAcceptance('Acceptance | OtherRoute', {
  beforeEach() {}
});

test('it happens with find', function() {
  visit('my-route');
  blur('#my-input');
  click('#my-block');
  find('#my-block');
  fillIn('#my-input', 'codemod');
  focus('#my-input');
  tap('#my-input');
  triggerEvent('#my-input', 'focusin');
  triggerKeyEvent('#my-input', 'keyup', 13);
});

moduleForAcceptance('Acceptance | AndThenRoute');

test('it works with andThen', function() {
  visit('my-route');
  andThen(() => {
    assert.ok(true);
    assert.ok(false);
  });
  find('#my-block');
});

test('it works with es5 andThen', function() {
  visit('my-route');
  andThen(function() {
    assert.ok(true);
    assert.ok(false);
  });
  find('#my-block');
});

test('it works with nested', function() {
  visit('my-route');
  andThen(function() {
    assert.equal(currenURL(), 'my-route');
    visit('other-route');
  });
  andThen(function() {
    assert.equal(currenURL(), 'other-route');
  });
});

test('it works with nested andThens', function() {
  visit('my-route');
  andThen(function() {
    assert.equal(currenURL(), 'my-route');
    visit('other-route');
    andThen(function() {
      assert.equal(currenURL(), 'other-route');
    });
  });
});

test('it works with assert.expect', function() {
  assert.expect(2);
  visit('my-route');
  andThen(function() {
    assert.equal(currenURL(), 'my-route');
    visit('other-route');
  });
  andThen(function() {
    assert.equal(currenURL(), 'other-route');
  });
});
