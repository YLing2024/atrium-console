import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latchActivated } from '../src/dbTab.ts';

test('latchActivated：未激活过且当前未激活，保持未激活', () => {
  assert.equal(latchActivated(false, false), false);
});

test('latchActivated：首次激活即置位', () => {
  assert.equal(latchActivated(false, true), true);
});

test('latchActivated：激活过之后切走不回落（iframe 不卸载）', () => {
  // 这条是「首次激活后保持挂载」的核心：若改成跟随 active 直接返回，此断言会红。
  assert.equal(latchActivated(true, false), true);
  assert.equal(latchActivated(true, true), true);
});
