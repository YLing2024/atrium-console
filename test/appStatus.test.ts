import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATUS_LABEL, statusOf } from '../src/appStatus.ts';

test('statusOf：白名单内原样返回', () => {
  assert.equal(statusOf({ status: 'up' } as never), 'up');
  assert.equal(statusOf({ status: 'idle' } as never), 'idle');
  assert.equal(statusOf({ status: 'degraded' } as never), 'degraded');
});

test('statusOf：未登记状态归为 unknown', () => {
  assert.equal(statusOf({ status: 'weird' } as never), 'unknown');
  assert.equal(statusOf({ status: '' } as never), 'unknown');
  assert.equal(statusOf({} as never), 'unknown');
});

test('STATUS_LABEL：六档文案与休眠语义', () => {
  assert.equal(STATUS_LABEL.idle, '休眠');
  assert.equal(STATUS_LABEL.degraded, '响应慢');
  assert.equal(STATUS_LABEL.auth, '需登录');
  assert.equal(Object.keys(STATUS_LABEL).length, 6);
});
