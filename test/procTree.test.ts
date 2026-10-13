import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProcTree, sortProcTree, type ProcRow, type ProcTreeNode } from '../src/procTree.ts';

// 递归统计一棵树里的全部节点数
function countNodes(nodes: ProcTreeNode<ProcRow>[]): number {
  let n = 0;
  for (const node of nodes) {
    n += 1;
    if (node.children) n += countNodes(node.children);
  }
  return n;
}

test('buildProcTree：按 pid/ppid 组树，ppid 不在列表内的作为根', () => {
  const rows: ProcRow[] = [
    { pid: 100, ppid: 1, name: 'a', mem_mb: 10 },
    { pid: 101, ppid: 100, name: 'b', mem_mb: 5 },
    { pid: 102, ppid: 100, name: 'c', mem_mb: 3 },
    { pid: 200, ppid: 0, name: 'd', mem_mb: 2 },
    { pid: 300, ppid: 999, name: 'e', mem_mb: 1 } // 父不在列表
  ];
  const tree = buildProcTree(rows);
  assert.equal(tree.length, 3); // a / d / e
  assert.equal(countNodes(tree), rows.length);
  const a = tree.find((n) => n.pid === 100);
  assert.ok(a);
  assert.equal(a.children?.length, 2);
  assert.equal(a.subtree_count, 3); // 自身 + b + c
  const b = a.children?.find((n) => n.pid === 101);
  assert.equal(b?.subtree_count, 1);
});

test('buildProcTree：自指 ppid 视为根', () => {
  const tree = buildProcTree([{ pid: 7, ppid: 7, name: 'self', mem_mb: 1 }]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].pid, 7);
  assert.equal(tree[0].subtree_count, 1);
});

test('buildProcTree：遇到环不无限递归，且节点一个不丢', () => {
  // a(1) <-> b(2) 互指；x(3) 挂在环上的 a 下
  const rows: ProcRow[] = [
    { pid: 1, ppid: 2, name: 'a', mem_mb: 1 },
    { pid: 2, ppid: 1, name: 'b', mem_mb: 1 },
    { pid: 3, ppid: 1, name: 'x', mem_mb: 1 }
  ];
  const tree = buildProcTree(rows);
  assert.equal(countNodes(tree), 3);
  // 无天然根：环上节点被提为根
  assert.ok(tree.length >= 1);
});

test('sortProcTree：同级按内存降序，递归作用到每一层', () => {
  const rows: ProcRow[] = [
    { pid: 1, ppid: 0, name: 'root-small', mem_mb: 1 },
    { pid: 2, ppid: 0, name: 'root-big', mem_mb: 50 },
    { pid: 3, ppid: 2, name: 'kid-small', mem_mb: 2 },
    { pid: 4, ppid: 2, name: 'kid-big', mem_mb: 9 }
  ];
  const tree = sortProcTree(buildProcTree(rows), 'mem');
  assert.deepEqual(
    tree.map((n) => n.pid),
    [2, 1]
  );
  const rootBig = tree.find((n) => n.pid === 2);
  assert.deepEqual(
    rootBig?.children?.map((n) => n.pid),
    [4, 3]
  );
});

test('sortProcTree：名称按 localeCompare zh 升序', () => {
  const tree = sortProcTree(
    buildProcTree([
      { pid: 1, ppid: 0, name: 'node' },
      { pid: 2, ppid: 0, name: 'python' },
      { pid: 3, ppid: 0, name: 'bash' }
    ]),
    'name'
  );
  assert.deepEqual(
    tree.map((n) => n.name),
    ['bash', 'node', 'python']
  );
});
