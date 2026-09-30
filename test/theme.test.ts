import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveTheme } from '../src/theme.ts';

test('effectiveTheme：显式深浅原样返回', () => {
  assert.equal(effectiveTheme('dark'), 'dark');
  assert.equal(effectiveTheme('light'), 'light');
});

test('effectiveTheme：auto 在无 window 环境回退 light', () => {
  // 单测运行在 Node（无 window/matchMedia），systemPrefersDark 走守卫分支返回 false
  assert.equal(effectiveTheme('auto'), 'light');
});
