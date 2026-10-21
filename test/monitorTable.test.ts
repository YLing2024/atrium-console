import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterDisks, filterPorts, filterProcesses, filterServices, mergeDiskRows } from '../src/monitorTable.ts';

test('filterProcesses：按名称或 PID 大小写不敏感，空查询原样返回', () => {
  const rows = [
    { name: 'nginx', pid: 100 },
    { name: 'Node', pid: 200 }
  ];
  assert.equal(filterProcesses(rows, '').length, 2);
  assert.deepEqual(filterProcesses(rows, 'NODE').map((r) => r.pid), [200]);
  assert.deepEqual(filterProcesses(rows, '10').map((r) => r.pid), [100]);
  assert.equal(filterProcesses(rows, 'missing').length, 0);
});

test('filterServices：按单元名搜索', () => {
  const rows = [{ unit: 'admin-server-go.service' }, { unit: 'nginx.service' }];
  assert.deepEqual(filterServices(rows, 'NGINX').map((r) => r.unit), ['nginx.service']);
  assert.equal(filterServices(rows, '  ').length, 2);
});

test('filterPorts：TCP / UDP / 仅监听 / 关键词组合生效', () => {
  const rows = [
    { port: 53, protocol: 'udp', state: 'UNCONN', process: 'systemd-resolve', address: '127.0.0.53' },
    { port: 80, protocol: 'tcp', state: 'LISTEN', process: 'nginx', address: '0.0.0.0' },
    { port: 443, protocol: 'tcp', state: 'LISTEN', process: 'nginx', address: '::' }
  ];
  assert.equal(filterPorts(rows, 'all', '').length, 3);
  assert.equal(filterPorts(rows, 'tcp', '').length, 2);
  assert.equal(filterPorts(rows, 'udp', '').length, 1);
  assert.equal(filterPorts(rows, 'listen', '').length, 2);
  assert.deepEqual(filterPorts(rows, 'all', 'nginx').map((r) => r.port), [80, 443]);
  assert.deepEqual(filterPorts(rows, 'tcp', '443').map((r) => r.port), [443]);
  assert.equal(filterPorts(rows, 'udp', 'nginx').length, 0);
});

test('mergeDiskRows：info 为主，按挂载点合并 SSE 速率，缺速率保留 null', () => {
  const rows = mergeDiskRows(
    [
      { mount: '/', filesystem: '/dev/vda1', fstype: 'ext4', total: 100, used: 40, percent: 40, inode_percent: 12 },
      { mount: '/data', filesystem: '/dev/vdb1', fstype: 'ext4', total: 200, used: 50, percent: 25 }
    ],
    [{ mount: '/', filesystem: '/dev/vda1', read_rate: 1024, write_rate: 2048, read_iops: 12.5, write_iops: 30, await_ms: 0.8 }]
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].read_rate, 1024);
  assert.equal(rows[0].inode_percent, 12);
  assert.equal(rows[0].read_iops, 12.5);
  assert.equal(rows[0].write_iops, 30);
  assert.equal(rows[0].await_ms, 0.8);
  assert.equal(rows[1].read_rate, null);
  assert.equal(rows[1].inode_percent, null);
  assert.equal(rows[1].await_ms, null);
});

test('mergeDiskRows：info 缺 inode 时回退 SSE 的 inode_percent', () => {
  const rows = mergeDiskRows(
    [{ mount: '/data', filesystem: '/dev/vdb1' }],
    [{ mount: '/data', filesystem: '/dev/vdb1', inode_percent: 44.5 }]
  );
  assert.equal(rows[0].inode_percent, 44.5);
});

test('filterDisks：按挂载点 / 设备 / 类型搜索', () => {
  const rows = mergeDiskRows([
    { mount: '/', filesystem: '/dev/vda1', fstype: 'ext4' },
    { mount: '/data', filesystem: '/dev/vdb1', fstype: 'xfs' }
  ]);
  assert.equal(filterDisks(rows, '/data').length, 1);
  assert.equal(filterDisks(rows, 'vda1').length, 1);
  assert.equal(filterDisks(rows, 'xfs').length, 1);
  assert.equal(filterDisks(rows, '').length, 2);
});
