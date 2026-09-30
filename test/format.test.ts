import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fmtBytes,
  fmtMB,
  fmtRate,
  fmtDuration,
  toneFor,
  fmtPct,
  niceMax,
  clampOffset,
  fmtSize,
  extOf
} from '../src/format.ts';

test('fmtBytes：1024 进制与非法值回退', () => {
  assert.equal(fmtBytes(0), '0.0 B');
  assert.equal(fmtBytes(1023), '1023.0 B');
  assert.equal(fmtBytes(1024), '1.0 KB');
  assert.equal(fmtBytes(1536), '1.5 KB');
  assert.equal(fmtBytes(1048576), '1.0 MB');
  assert.equal(fmtBytes(5 * 1024 ** 4), '5.0 TB');
  assert.equal(fmtBytes(null), '—');
  assert.equal(fmtBytes(undefined), '—');
  assert.equal(fmtBytes(Number.NaN), '—');
});

test('fmtMB：整数不带小数，非整数保留一位', () => {
  assert.equal(fmtMB(0), '0 MB');
  assert.equal(fmtMB(512), '512 MB');
  assert.equal(fmtMB(1.5), '1.5 MB');
  assert.equal(fmtMB(null), '—');
  assert.equal(fmtMB('x'), '—');
});

test('fmtRate：复用 fmtBytes 并补 /s', () => {
  assert.equal(fmtRate(2048), '2.0 KB/s');
  assert.equal(fmtRate(0), '0.0 B/s');
  assert.equal(fmtRate(null), '—');
});

test('fmtDuration：天/小时/分钟拼接，不足一分钟为「刚刚」', () => {
  assert.equal(fmtDuration(0), '刚刚');
  assert.equal(fmtDuration(59), '刚刚');
  assert.equal(fmtDuration(60), '1 分钟');
  assert.equal(fmtDuration(3600), '1 小时');
  assert.equal(fmtDuration(86400), '1 天');
  assert.equal(fmtDuration(90061), '1 天 1 小时 1 分钟');
  assert.equal(fmtDuration('3600'), '1 小时');
  assert.equal(fmtDuration(null), '—');
});

test('toneFor：>80 红、60-80 橙、<60 绿，且钳制到 0-100', () => {
  assert.equal(toneFor(100), 'hi');
  assert.equal(toneFor(81), 'hi');
  assert.equal(toneFor(80), 'mid');
  assert.equal(toneFor(60), 'mid');
  assert.equal(toneFor(59), 'low');
  assert.equal(toneFor(0), 'low');
  assert.equal(toneFor(150), 'hi');
  assert.equal(toneFor(-5), 'low');
  assert.equal(toneFor(null), 'low');
});

test('fmtPct：有限数保留一位，NaN 回退 —', () => {
  assert.equal(fmtPct(12.34), '12.3');
  assert.equal(fmtPct('50'), '50.0');
  assert.equal(fmtPct(undefined), '—');
  assert.equal(fmtPct('abc'), '—');
});

test('niceMax：向上取整到 1/2/5×10^n', () => {
  assert.equal(niceMax(0), 1);
  assert.equal(niceMax(-3), 1);
  assert.equal(niceMax(1), 1);
  assert.equal(niceMax(1.5), 2);
  assert.equal(niceMax(3), 5);
  assert.equal(niceMax(7), 10);
  assert.equal(niceMax(11), 20);
  assert.equal(niceMax(1234), 2000);
});

test('clampOffset：钳制到 [0, len-win]，len<win 时为 0', () => {
  assert.equal(clampOffset(5, 10, 4), 5);
  assert.equal(clampOffset(20, 10, 4), 6);
  assert.equal(clampOffset(-3, 10, 4), 0);
  assert.equal(clampOffset(2, 3, 10), 0);
});

test('fmtSize：1024 进制，≥100 不留小数', () => {
  assert.equal(fmtSize(null), '—');
  assert.equal(fmtSize(undefined), '—');
  assert.equal(fmtSize(512), '512 B');
  assert.equal(fmtSize(1024), '1.0 KB');
  assert.equal(fmtSize(1536), '1.5 KB');
  assert.equal(fmtSize(1024 * 100), '100 KB');
  assert.equal(fmtSize(1024 * 1024), '1.0 MB');
});

test('extOf：大写扩展名最多 5 位，无扩展名/隐藏文件为空', () => {
  assert.equal(extOf('report.pdf'), 'PDF');
  assert.equal(extOf('a.tar.gz'), 'GZ');
  assert.equal(extOf('x.verylongext'), 'VERYL');
  assert.equal(extOf('Makefile'), '');
  assert.equal(extOf('.gitignore'), '');
  assert.equal(extOf('trailing.'), '');
});
