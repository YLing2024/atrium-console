/**
 * MonitorTables —— 监控页中部的 Top 进程与 Top 服务两张表。
 *
 * 数据来源：
 * - 进程：父级每 5s 取 `/api/admin/services`（含 thread_count 与 cgroup_mem_mb，能填满七列）；
 * - 服务：系统 SSE 的 `top_services`（system.slice 下各单元的 cgroup CPU / 内存）。
 *
 * 两张表都只取前 8 行并按 CPU 降序，保持「Top」语义；窄屏时表格在卡片内横向滚动，
 * 不让页面出现横向滚动条。空态统一显示破折号。
 */
import { Card, Table, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import type { ProcessInfo, ServiceCpu } from '../api';
import { fmtMB, fmtPct } from '../format';

export interface TopProcessesProps {
  /** `/api/admin/services` 的 processes */
  processes: ProcessInfo[];
}

export interface TopServicesProps {
  /** 系统 SSE 的 top_services */
  services: ServiceCpu[];
}

const processColumns: TableColumnsType<ProcessInfo> = [
  {
    title: '名称',
    dataIndex: 'name',
    key: 'name',
    ellipsis: true,
    render: (value: string | undefined) => (
      <Typography.Text ellipsis={{ tooltip: value }}>{value || '—'}</Typography.Text>
    )
  },
  {
    title: 'PID',
    dataIndex: 'pid',
    key: 'pid',
    width: 76,
    align: 'right',
    className: 'monitor-num'
  },
  {
    title: 'CPU',
    dataIndex: 'cpu',
    key: 'cpu',
    width: 76,
    align: 'right',
    className: 'monitor-num',
    render: (value: number | undefined) =>
      value == null || !Number.isFinite(Number(value)) ? '—' : fmtPct(value) + '%'
  },
  {
    title: '内存',
    dataIndex: 'mem_mb',
    key: 'mem_mb',
    width: 92,
    align: 'right',
    className: 'monitor-num',
    render: (value: number | undefined) => fmtMB(value)
  },
  {
    title: '线程',
    dataIndex: 'thread_count',
    key: 'thread_count',
    width: 72,
    align: 'right',
    className: 'monitor-num',
    render: (value: number | null | undefined) => (value == null ? '—' : String(value))
  },
  {
    title: 'cgroup 内存',
    dataIndex: 'cgroup_mem_mb',
    key: 'cgroup_mem_mb',
    width: 96,
    align: 'right',
    className: 'monitor-num',
    render: (value: number | null | undefined) => (value == null ? '—' : fmtMB(value))
  }
];

const serviceColumns: TableColumnsType<ServiceCpu> = [
  {
    title: '单元',
    dataIndex: 'unit',
    key: 'unit',
    ellipsis: true,
    render: (value: string | undefined) => (
      <Typography.Text ellipsis={{ tooltip: value }}>{value || '—'}</Typography.Text>
    )
  },
  {
    title: 'CPU',
    dataIndex: 'cpu_percent',
    key: 'cpu_percent',
    width: 84,
    align: 'right',
    className: 'monitor-num',
    render: (value: number | undefined) =>
      value == null || !Number.isFinite(Number(value)) ? '—' : fmtPct(value) + '%'
  },
  {
    title: '内存',
    dataIndex: 'mem_mb',
    key: 'mem_mb',
    width: 92,
    align: 'right',
    className: 'monitor-num',
    render: (value: number | null | undefined) => (value == null ? '—' : fmtMB(value))
  }
];

/** 按 CPU 降序取前 8 行；不改原数组。 */
function topByCpu<T extends { cpu?: number; cpu_percent?: number }>(rows: T[]): T[] {
  return [...rows]
    .sort((a, b) => Number(b.cpu ?? b.cpu_percent ?? 0) - Number(a.cpu ?? a.cpu_percent ?? 0))
    .slice(0, 8);
}

/**
 * Top 进程卡片。
 * @param props 见 {@link TopProcessesProps}
 */
export function TopProcesses({ processes }: TopProcessesProps) {
  return (
    <Card
      className="monitor-card"
      title="Top 进程"
      extra={<Typography.Text type="secondary">按 CPU</Typography.Text>}
      style={{ height: '100%' }}
    >
      <Table<ProcessInfo>
        rowKey={(row) => String(row.pid)}
        size="small"
        columns={processColumns}
        dataSource={topByCpu(processes)}
        pagination={false}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: '—' }}
      />
    </Card>
  );
}

/**
 * Top 服务卡片。
 * @param props 见 {@link TopServicesProps}
 */
export function TopServices({ services }: TopServicesProps) {
  return (
    <Card
      className="monitor-card"
      title="Top 服务"
      extra={<Typography.Text type="secondary">按 CPU</Typography.Text>}
      style={{ height: '100%' }}
    >
      <Table<ServiceCpu>
        rowKey={(row) => row.unit || 'unknown'}
        size="small"
        columns={serviceColumns}
        dataSource={topByCpu(services as Array<ServiceCpu & { cpu?: number }>)}
        pagination={false}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: '—' }}
      />
    </Card>
  );
}
