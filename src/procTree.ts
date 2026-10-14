// 「系统」Tab 进程树：把后端 `GET /api/admin/services` 返回的全量进程按 pid/ppid
// 组装成 antd Table 可直接渲染的树数据（纯函数、无副作用，供组件与校验脚本共用）。
//
// 组树规则：
// - `ppid` 不在本次列表内（含 0 / 1）、指向自身或缺失 → 该节点为根；
// - 发现环（沿 parent 走回已访问节点）时把该节点提为根，绝不无限递归。
//
// 子树字段（subtree_mem_mb / subtree_cpu / subtree_count）一律**沿用后端返回值**，
// 前端不再自己数（2026-10-14 改为服务端算好；口径见 admin-server `docs/API.md`）。

export interface ProcRow {
  pid: number;
  ppid?: number;
  name?: string;
  mem_mb?: number;
  cpu?: number;
  subtree_mem_mb?: number;
  subtree_cpu?: number;
  subtree_count?: number;
  cgroup_mem_mb?: number | null;
}

/** 组树后的节点：原字段 + children（子进程）；子树字段沿用后端返回值 */
export type ProcTreeNode<T extends ProcRow> = T & {
  children?: ProcTreeNode<T>[];
};

export type ProcSortKey = 'name' | 'mem' | 'cpu';

// 同级排序：名称升序（localeCompare('zh')）/ 内存 / CPU 降序。
// 内存排序按「含子进程合计」（subtree_mem_mb，缺省回退自身 mem_mb），与内存列主显示口径一致。
export function procSortCompare(a: ProcRow, b: ProcRow, key: ProcSortKey): number {
  if (key === 'name') return String(a.name ?? '').localeCompare(String(b.name ?? ''), 'zh');
  const av = Number(key === 'mem' ? a.subtree_mem_mb ?? a.mem_mb : a.cpu) || 0;
  const bv = Number(key === 'mem' ? b.subtree_mem_mb ?? b.mem_mb : b.cpu) || 0;
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

  function attach(node: ProcTreeNode<T>): void {
    state.set(node.pid, 1);
    const kids: ProcTreeNode<T>[] = [];
    for (const cpid of childrenOf.get(node.pid) || []) {
      const s = state.get(cpid);
      if (s === 1 || s === 2) continue; // 环回边 / 已挂载：跳过，杜绝无限递归与重复挂载
      const child = nodes.get(cpid);
      if (!child) continue;
      attach(child);
      kids.push(child);
    }
    if (kids.length) node.children = kids;
    state.set(node.pid, 2);
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

// 收集树中全部 pid（深度优先）。供组件在拿到第一份进程数据后一次性算出「全部展开」键，
// 之后交给受控 expandedRowKeys，用户手动折叠的选择不再被轮询刷新覆盖。
export function collectProcPids<T extends ProcRow>(tree: ProcTreeNode<T>[]): number[] {
  const out: number[] = [];
  const walk = (nodes: ProcTreeNode<T>[]): void => {
    for (const n of nodes) {
      out.push(n.pid);
      if (n.children && n.children.length) walk(n.children);
    }
  };
  walk(tree);
  return out;
}
