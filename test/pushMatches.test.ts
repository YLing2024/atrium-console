import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushMatches } from '../src/notificationPush.ts';
import type { NotificationItem } from '../src/api.ts';

function item(partial: Partial<NotificationItem>): NotificationItem {
  return { id: 0, title: '', ...partial } as NotificationItem;
}

test('pushMatches：优先按 id 匹配', () => {
  assert.equal(pushMatches(item({ id: 7 }), { id: 7 }), true);
  assert.equal(pushMatches(item({ id: 7 }), { id: 8 }), false);
  // 字符串 id 也会归一化比较
  assert.equal(pushMatches(item({ id: 7 }), { id: '7' as unknown as number }), true);
});

test('pushMatches：无 id 时退化为 dedupKey', () => {
  assert.equal(pushMatches(item({ id: null as never, dedupKey: 'k' }), { dedupKey: 'k' }), true);
  assert.equal(pushMatches(item({ id: null as never, dedupKey: 'k' }), { dedupKey: 'z' }), false);
});

test('pushMatches：再退化为 标题+来源', () => {
  assert.equal(pushMatches(item({ id: null as never, title: 't', source: 's' }), { title: 't' }), true);
  assert.equal(
    pushMatches(item({ id: null as never, title: 't', source: 'a' }), { title: 't', source: 'b' }),
    false
  );
  assert.equal(
    pushMatches(item({ id: null as never, title: 't', source: 'a' }), { title: 't', source: 'a' }),
    true
  );
});

test('pushMatches：无标题目标或空条目一律不匹配', () => {
  assert.equal(pushMatches(item({ id: null as never, title: 't' }), { title: '' }), false);
  assert.equal(pushMatches(null, { id: 1 }), false);
  assert.equal(pushMatches(item({ id: 1 }), null), false);
});
