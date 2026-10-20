import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bitwardenStatusText } from '../src/format.ts';
import { remainingFromExpiresAt } from '../src/toolStatus.ts';

test('bitwardenStatusText：未配置优先，其次锁定/解锁', () => {
  assert.equal(bitwardenStatusText(false, true, 3600), '未配置');
  assert.equal(bitwardenStatusText(true, false, null), '已锁定');
  assert.equal(bitwardenStatusText(true, false, 3600), '已锁定');
});

test('bitwardenStatusText：剩余时间与非 JWT 的口径', () => {
  assert.equal(bitwardenStatusText(true, true, 3 * 3600 + 42 * 60), '已解锁（剩 3 小时 42 分钟）');
  assert.equal(bitwardenStatusText(true, true, null), '已解锁（有效期未知）');
  assert.equal(bitwardenStatusText(true, true, 0), '已解锁（已过期）');
});

test('remainingFromExpiresAt：缺失回 null，过去钳制为 0，未来向下取整', () => {
  assert.equal(remainingFromExpiresAt(null), null);
  assert.equal(remainingFromExpiresAt(undefined), null);
  assert.equal(remainingFromExpiresAt(Number.NaN), null);
  assert.equal(remainingFromExpiresAt(1_000_000, 2_000_000), 0);
  assert.equal(remainingFromExpiresAt(2_000_000, 1_000_000), 1000);
  assert.equal(remainingFromExpiresAt(2_000_999, 1_000_000), 1000);
});
