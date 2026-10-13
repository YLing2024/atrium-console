// 「系统」Tab 进程树：把后端 `GET /api/admin/services` 返回的全量进程按 pid/ppid
// 组装成 antd Table 可直接渲染的树数据（纯函数、无副作用，供组件与校验脚本共用）。
//
// 组树规则：
// - `ppid` 不在本次列表内（含 0 / 1）、指向自身或缺失 → 该节点为根；
// - 发现环（沿 parent 走回已访问节点）时把该节点提为根，绝不无限递归；
// - 每个节点补 `subtree_count`（含自身的后代进程数），供「N 个进程」次要文字使用。

export interface ProcRow {
  pid: number;
  ppid?: number;
  name?: string;
  mem_mb?: number;
  cpu?: number;
  subtree_mem_mb?: number;
  subtree_cpu?: number;
}

/** 组树后的节点：原字段 + children（子进程）+ subtree_count（含自身的后代数） */
export type ProcTreeNode<T extends ProcRow> = T & {
  children?: ProcTreeNode<T>[];
  subtree_count?: number;
};

export type ProcSortKey = 'name' | 'mem' | 'cpu';

// 同级排序：名称升序（localeCompare('zh')）/ 内存 / CPU 降序（沿用组件原 procSort 语义）
export function procSortCompare(a: ProcRow, b: ProcRow, key: ProcSortKey): number {
  if (key === 'name') return String(a.name ?? '').localeCompare(String(b.name ?? ''), 'zh');
  const av = Number(key === 'mem' ? a.mem_mb : a.cpu) || 0;
  const bv = Number(key === 'mem' ? b.mem_mb : b.cpu) || 0;
  return bv - av;
}

// 按 pid/ppid 组树，返回根节点数组。节点数恒等于输入条数（环只断边、不丢节点）。
export function buildProcTree<T extends ProcRow>(rows: T[]): ProcTreeNode<T>[] {
  const nodes = new Map<number, ProcTreeNode<T>>();
  for (const r of rows) nodes.set(r.pid, { ...r });

  // 只保留「父节点在本次列表内且不是自身」的边；其余（0/1/缺失/自指）视为根
  const childrenOf = new Map<number, number[]>();
  for (const r of rows) {
    const ppid = r.ppid;
    if (ppid == null || ppid === r.pid || !nodes.has(ppid)) continue;
    const list = childrenOf.get(ppid);
    if (list) list.push(r.pid);
    else childrenOf.set(ppid, [r.pid]);
  }

  const state = new Map<number, 0 | 1 | 2>(); // 0 未访问 / 1 递归中 / 2 已完成
  const roots: ProcTreeNode<T>[] = [];

  function attach(node: ProcTreeNode<T>): number {
    state.set(node.pid, 1);
    let size = 1;
    const kids: ProcTreeNode<T>[] = [];
    for (const cpid of childrenOf.get(node.pid) || []) {
      const s = state.get(cpid);
      if (s === 1 || s === 2) continue; // 环回边 / 已挂载：跳过，杜绝无限递归与重复挂载
      const child = nodes.get(cpid);
      if (!child) continue;
      size += attach(child);
      kids.push(child);
    }
    if (kids.length) node.children = kids;
    node.subtree_count = size;
    state.set(node.pid, 2);
    return size;
  }

  // 按 pid 升序遍历，未访问者作为根：先天然根，后环上的节点（提为根）
  const order = rows.map((r) => r.pid).sort((a, b) => a - b);
  for (const pid of order) {
    if (state.has(pid)) continue;
    const node = nodes.get(pid);
    if (!node) continue;
    attach(node);
    roots.push(node);
  }
  return roots;
}

// 递归排序（排序只作用在兄弟之间），就地修改并返回同一数组
export function sortProcTree<T extends ProcRow>(
  tree: ProcTreeNode<T>[],
  key: ProcSortKey
): ProcTreeNode<T>[] {
  tree.sort((a, b) => procSortCompare(a, b, key));
  for (const node of tree) {
    if (node.children && node.children.length) sortProcTree(node.children, key);
  }
  return tree;
}
