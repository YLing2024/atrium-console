import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSparkGeometry,
  columnValues,
  formatTrendTick,
  loadavgText,
  monitorRangeSpec,
  pickRootDisk,
  pressureTone,
  stallTone,
  thresholdTone,
  withAlpha
} from '../src/monitor.ts';

test('buildSparkGeometry：尖峰会顶到上边距，且最后一个点靠右', () => {
  const geo = buildSparkGeometry([1, 1, 100, 1]);
  assert.ok(geo);
  const points = geo.line.split(' ').map((p) => p.split(',').map(Number));
  assert.equal(points.length, 4);
  const spike = points[2];
  assert.equal(spike[0], 26); // pad 2 + 2/3 * 36
  assert.equal(spike[1], 2); // 最大值贴住上边距
  assert.equal(points[3][0], 38);
  assert.equal(points[3][1], 26); // 最小值贴住下边距
});

test('buildSparkGeometry：恒定值走中线，不产生 NaN', () => {
  const geo = buildSparkGeometry([5, 5, 5]);
  assert.ok(geo);
  assert.ok(!geo.line.includes('NaN'));
  for (const pair of geo.line.split(' ')) {
    assert.equal(Number(pair.split(',')[1]), 14);
  }
});

test('buildSparkGeometry：单点 / 空值 / 全非法值', () => {
  const one = buildSparkGeometry([42]);
  assert.ok(one);
  assert.equal(one.line, '');
  assert.deepEqual(one.point, { x: 20, y: 14 });

  assert.equal(buildSparkGeometry([]), null);
  assert.equal(buildSparkGeometry([null, undefined]), null);

  const gap = buildSparkGeometry([1, null, 3]);
  assert.ok(gap);
  assert.equal(gap.line.split(' ').length, 2);
});

test('pressureTone：<20 常态、20–50 预警、>50 危险', () => {
  assert.equal(pressureTone(0), 'normal');
  assert.equal(pressureTone(19.99), 'normal');
  assert.equal(pressureTone(20), 'warning');
  assert.equal(pressureTone(50), 'warning');
  assert.equal(pressureTone(50.01), 'error');
  assert.equal(pressureTone(null), 'normal');
});

test('thresholdTone：越过阈值才变色，非法值保持常态', () => {
  assert.equal(thresholdTone(69.9, 70, 85), 'normal');
  assert.equal(thresholdTone(70, 70, 85), 'warning');
  assert.equal(thresholdTone(85, 70, 85), 'error');
  assert.equal(thresholdTone(Number.NaN, 70, 85), 'normal');
});

test('withAlpha：支持 hex / rgb / 未知格式', () => {
  assert.equal(withAlpha('#1677ff', 0.08), 'rgba(22, 119, 255, 0.08)');
  assert.equal(withAlpha('#abc', 0.5), 'rgba(170, 187, 204, 0.5)');
  assert.equal(withAlpha('rgb(1, 2, 3)', 0.2), 'rgba(1, 2, 3, 0.2)');
  assert.equal(withAlpha('currentColor', 0.2), 'currentColor');
});

test('pickRootDisk：优先根分区，其次首盘，最后旧单盘字段', () => {
  const data = [
    { mount: '/data', percent: 70 },
    { mount: '/', percent: 40 }
  ];
  assert.equal(pickRootDisk(data)?.percent, 40);
  assert.equal(pickRootDisk([{ mount: '/data', percent: 70 }])?.percent, 70);
  assert.equal(pickRootDisk([], { mount: '/', percent: 12 })?.percent, 12);
  assert.equal(pickRootDisk(null), null);
});

test('monitorRangeSpec：四档参数与默认回退', () => {
  assert.deepEqual(monitorRangeSpec('1h'), {
    id: '1h',
    label: '1h',
    range: '1h',
    step: '1m',
    refreshMs: 30000
  });
  assert.equal(monitorRangeSpec('7d').step, '1h');
  // @ts-expect-error 运行时防御：未知值回退 24h
  assert.equal(monitorRangeSpec('nope').id, '24h');
});

test('loadavgText：数组取三位小数，字符串原样，缺失破折号', () => {
  assert.equal(loadavgText([2.531, 2.55, 3]), '2.53 / 2.55 / 3.00');
  assert.equal(loadavgText('1.2 1.3 1.4'), '1.2 1.3 1.4');
  assert.equal(loadavgText(null), '—');
});

test('formatTrendTick：7 天档带日期，其余只到分钟', () => {
  const ts = new Date(2026, 9, 20, 9, 5).getTime();
  assert.equal(formatTrendTick(ts, '1h'), '09:05');
  assert.equal(formatTrendTick(ts, '7d'), '10-20 09:00');
  assert.equal(formatTrendTick(Number.NaN, '1h'), '—');
});

test('stallTone：档位文案映射语义色', () => {
  assert.equal(stallTone('顺畅'), 'normal');
  assert.equal(stallTone('有压力'), 'warning');
  assert.equal(stallTone('明显卡顿'), 'error');
  assert.equal(stallTone(undefined), 'normal');
});

test('columnValues：缺列保留 null，不把缺失当 0', () => {
  assert.deepEqual(columnValues([{ cpu: 1 }, {}, { cpu: 3 }], 'cpu'), [1, null, 3]);
});
