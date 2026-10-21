/**
 * 监控页表格的纯过滤 / 合并函数：无 DOM、无请求，便于单测。
 *
 * 组件只负责渲染，搜索词、协议档位与磁盘双来源（info 的 inode + SSE 的速率）
 * 的合并规则集中在这里，避免三个表格各写一套边界判断。
 */
import type {
  DiskInfo,
  ProcessInfo,
  SystemDiskInfo,
  SystemPortInfo,
  SystemServiceInfo
} from './api';

/** 端口过滤档位：全部 / TCP / UDP / 仅监听（只留 TCP LISTEN）。 */
export type PortFilter = 'all' | 'tcp' | 'udp' | 'listen';

/** 进程按名称或 PID 搜索；空查询返回原数组。 */
export function filterProcesses(rows: ProcessInfo[], query: string): ProcessInfo[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return rows;
  return rows.filter((row) => {
    const name = String(row.name || '').toLowerCase();
    const pid = String(row.pid ?? '');
    return name.includes(keyword) || pid.includes(keyword);
  });
}

/** 服务按单元名搜索；空查询返回原数组。 */
export function filterServices(rows: SystemServiceInfo[], query: string): SystemServiceInfo[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return rows;
  return rows.filter((row) => String(row.unit || '').toLowerCase().includes(keyword));
}

/** 协议 / 仅监听 / 关键词的组合过滤；空关键词返回当前档位下的全部行。 */
export function filterPorts(rows: SystemPortInfo[], filter: PortFilter, query: string): SystemPortInfo[] {
  const keyword = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter === 'tcp' && row.protocol !== 'tcp') return false;
    if (filter === 'udp' && row.protocol !== 'udp') return false;
    if (filter === 'listen' && row.state !== 'LISTEN') return false;
    if (!keyword) return true;
    return (
      String(row.port ?? '').includes(keyword) ||
      String(row.process || '').toLowerCase().includes(keyword) ||
      String(row.address || '').toLowerCase().includes(keyword)
    );
  });
}

/** 磁盘表的一行：容量 / inode 来自 info，读写速率来自 SSE。 */
export interface DiskRow {
  mount: string;
  filesystem: string;
  fstype: string;
  total: number | null;
  used: number | null;
  percent: number | null;
  inode_total: number | null;
  inode_used: number | null;
  inode_percent: number | null;
  read_rate: number | null;
  write_rate: number | null;
  read_iops: number | null;
  write_iops: number | null;
  await_ms: number | null;
}

/** 以 info 的挂载点为主，按 mount / filesystem 合并实时速率；不改原数组。 */
export function mergeDiskRows(disks: SystemDiskInfo[], live: DiskInfo[] = []): DiskRow[] {
  return disks.map((disk) => {
    const matched = live.find(
      (item) =>
        (disk.mount && item.mount === disk.mount) ||
        (disk.filesystem && item.filesystem === disk.filesystem)
    );
    return {
      mount: disk.mount || '—',
      filesystem: disk.filesystem || '—',
      fstype: disk.fstype || '—',
      total: disk.total ?? null,
      used: disk.used ?? null,
      percent: disk.percent ?? null,
      inode_total: disk.inode_total ?? null,
      inode_used: disk.inode_used ?? null,
      inode_percent: disk.inode_percent ?? matched?.inode_percent ?? null,
      read_rate: matched?.read_rate ?? null,
      write_rate: matched?.write_rate ?? null,
      read_iops: matched?.read_iops ?? null,
      write_iops: matched?.write_iops ?? null,
      await_ms: matched?.await_ms ?? null
    };
  });
}

/** 磁盘按挂载点 / 文件系统 / 类型搜索。 */
export function filterDisks(rows: DiskRow[], query: string): DiskRow[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return rows;
  return rows.filter(
    (row) =>
      row.mount.toLowerCase().includes(keyword) ||
      row.filesystem.toLowerCase().includes(keyword) ||
      row.fstype.toLowerCase().includes(keyword)
  );
}
