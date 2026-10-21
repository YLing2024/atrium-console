import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLogDetailFields,
  formatLogDuration,
  formatLogTime,
  logJson,
  nextLogOffset,
  shouldAutoLoad,
  sourceLabel,
  type LogEntry
} from '../src/logs.ts';

test('formatLogTime：本地时间 + 毫秒，非法值原样返回', () => {
  assert.equal(formatLogTime('2026-01-02T03:04:05.678'), '2026-01-02 03:04:05.678');
  assert.equal(formatLogTime('not-a-time'), 'not-a-time');
});

test('formatLogDuration：补秒单位，空值留给字段表过滤', () => {
  assert.equal(formatLogDuration('0.123'), '0.123 s');
  assert.equal(formatLogDuration(' 2 '), '2 s');
  assert.equal(formatLogDuration(''), '');
  assert.equal(formatLogDuration(undefined), '');
  assert.equal(formatLogDuration('abc'), 'abc');
});

test('buildLogDetailFields：只保留有值字段，顺序稳定', () => {
  const fields = buildLogDetailFields({
    ts: '',
    source: 'access',
    name: '',
    level: '',
    message: '',
    method: 'GET',
    path: '/api/x',
    status: '200',
    duration: '0.012',
    client_ip: '203.0.113.7'
  });
  assert.deepEqual(
    fields.map((f) => f.label),
    ['请求方法', '路径', '状态码', '耗时', '客户端 IP']
  );
  assert.equal(fields[3].value, '0.012 s');
});

test('buildLogDetailFields：全空时返回空数组', () => {
  const entry: LogEntry = { ts: '', source: 'error', name: '', level: '', message: '' };
  assert.deepEqual(buildLogDetailFields(entry), []);
});

test('shouldAutoLoad：触底才触发，加载中 / 失败 / 没有下一页都拦住', () => {
  const base = { scrollTop: 900, clientHeight: 300, scrollHeight: 1200, loading: false, hasMore: true, failed: false };
  assert.equal(shouldAutoLoad(base), true);
  assert.equal(shouldAutoLoad({ ...base, scrollTop: 100 }), false);
  assert.equal(shouldAutoLoad({ ...base, loading: true }), false);
  assert.equal(shouldAutoLoad({ ...base, failed: true }), false);
  assert.equal(shouldAutoLoad({ ...base, hasMore: false }), false);
});

test('nextLogOffset：按服务端 limit 前进，不按返回条数', () => {
  assert.equal(nextLogOffset({ offset: 0, limit: 200 }, 200), 200);
  assert.equal(nextLogOffset({ offset: 400, limit: 200 }, 200), 600);
  // 后端返回被跳过的坏时间戳时 entries 会少于 limit，但 offset 仍按 limit 前进，避免重复扫描。
  assert.equal(nextLogOffset({ offset: 0, limit: 0 }, 200), 200);
});

test('sourceLabel：已知来源中文名，未知原样返回', () => {
  assert.equal(sourceLabel('system'), '系统 journald');
  assert.equal(sourceLabel('access'), 'Nginx access');
  assert.equal(sourceLabel('new-source'), 'new-source');
  assert.equal(sourceLabel(''), '—');
});

test('logJson：缩进两格且包含详情字段', () => {
  const json = logJson({
    ts: '2026-01-02T03:04:05Z',
    source: 'system',
    name: 'nginx.service',
    level: 'info',
    message: 'hello',
    host: 'web-1'
  });
  assert.match(json, /"host": "web-1"/);
  assert.match(json, /\n  "ts"/);
});
