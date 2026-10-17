import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unlockRequiredOf } from '../src/termGate.ts';

test('unlockRequiredOf：unlockRequired=false 表示免口令', () => {
  assert.equal(unlockRequiredOf({ unlockRequired: false }), false);
});

test('unlockRequiredOf：unlockRequired=true 表示仍需口令', () => {
  assert.equal(unlockRequiredOf({ unlockRequired: true }), true);
});

test('unlockRequiredOf：缺字段按需要口令兜底', () => {
  assert.equal(unlockRequiredOf({}), true);
});

test('unlockRequiredOf：非布尔值一律按需要口令兜底', () => {
  assert.equal(unlockRequiredOf({ unlockRequired: 'false' }), true);
  assert.equal(unlockRequiredOf({ unlockRequired: 0 }), true);
  assert.equal(unlockRequiredOf({ unlockRequired: null }), true);
});

test('unlockRequiredOf：非对象 / 解析失败按需要口令兜底', () => {
  assert.equal(unlockRequiredOf(null), true);
  assert.equal(unlockRequiredOf(undefined), true);
  assert.equal(unlockRequiredOf('{bad json'), true);
  assert.equal(unlockRequiredOf([]), true);
});
