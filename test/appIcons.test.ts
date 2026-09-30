import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appIconChildren, appIconFallbackText } from '../src/appIcons.ts';

test('appIconChildren：命中登记表返回 SVG 子元素', () => {
  const home = appIconChildren('home');
  assert.ok(Array.isArray(home));
  assert.equal(home.length, 2);
  assert.ok(home.every((s) => s.startsWith('<')));
  assert.ok(home[0].includes('<path'));

  const bell = appIconChildren('bell');
  assert.ok(bell && bell.length === 2);
});

test('appIconChildren：未命中/空返回 undefined（走文字回退）', () => {
  assert.equal(appIconChildren('no-such-icon'), undefined);
  assert.equal(appIconChildren(''), undefined);
  assert.equal(appIconChildren(undefined), undefined);
  assert.equal(appIconChildren(null), undefined);
  // 历史中文单字图标名不在登记表内
  assert.equal(appIconChildren('博'), undefined);
});

test('appIconFallbackText：取首字，null/undefined 回退 ?', () => {
  assert.equal(appIconFallbackText('博客'), '博');
  assert.equal(appIconFallbackText('Blog'), 'B');
  assert.equal(appIconFallbackText(undefined), '?');
  assert.equal(appIconFallbackText(null), '?');
  assert.equal(appIconFallbackText(''), '');
});
