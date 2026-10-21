/**
 * MonitorDiskTable —— 监控页「磁盘」全量表，紧跟趋势区展示每个挂载点。
 *
 * 挂载点、容量与 inode 来自 `/api/admin/system/info`（含全部真实块设备挂载点）；
 * 读写速率、IOPS、await 来自系统 SSE 的 `disks[]`，按挂载点与 filesystem 合并。
 * 任一来源缺失时对应单元格显示破折号，不伪造 0。
 */
import { useMemo, useState } from 'react';
import { Card, Input, Progress, Table, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import type { DiskInfo, SystemDiskInfo } from '../api';
import { fmtBytes, fmtRate } from '../format';
import { filterDisks, mergeDiskRows, type DiskRow } from '../monitorTable';

export interface MonitorDiskTableProps {
  /** `/api/admin/system/info` 的 disks（含 inode） */
  disks: SystemDiskInfo[];
  /** 系统 SSE 的 disks（含速率 / IOPS / await；可缺） */
  live?: DiskInfo[];
  loading?: boolean;
}

/** 磁盘使用率进度条：颜色只作辅助，右侧始终有数字。 */
function DiskUsage({ value }: { value: number | null }) {
  if (value == null || !Number.isFinite(value)) return <span>—</span>;
  const clamped = Math.max(0, Math.min(100, value));
  const color =
    clamped >= 85
      ? 'var(--ant-color-error)'
      : clamped >= 75
        ? 'var(--ant-color-warning)'
        : 'var(--ant-color-primary)';
  return (
    <span className="monitor-disk-usage">
      <Progress
        percent={clamped}
        showInfo={false}
        size="small"
        strokeColor={color}
        aria-label={`使用率 ${value.toFixed(1)}%`}
      />
      <span className="monitor-num">{value.toFixed(1)}%</span>
    </span>
  );
}

/** IOPS / await 的数值格式化：缺数据统一破折号。 */
function numberOrDash(value: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

const columns: TableColumnsType<DiskRow> = [
  {
    title: '挂载点',
    dataIndex: 'mount',
    key: 'mount',
    ellipsis: true,
    sorter: (a, b) => a.mount.localeCompare(b.mount),
    render: (value: string) => <Typography.Text ellipsis={{ tooltip: value }}>{value}</Typography.Text>
  },
  {
    title: '设备',
    dataIndex: 'filesystem',
    key: 'filesystem',
    ellipsis: true,
    sorter: (a, b) => a.filesystem.localeCompare(b.filesystem),
    render: (value: string) => <Typography.Text ellipsis={{ tooltip: value }}>{value}</Typography.Text>
  },
  {
    title: '使用率',
    dataIndex: 'percent',
    key: 'percent',
    width: 180,
    sorter: (a, b) => Number(a.percent ?? 0) - Number(b.percent ?? 0),
    render: (value: number | null) => <DiskUsage value={value} />
  },
  {
    title: '已用',
    dataIndex: 'used',
    key: 'used',
    width: 110,
    align: 'right',
    className: 'monitor-num',
    sorter: (a, b) => Number(a.used ?? 0) - Number(b.used ?? 0),
    render: (value: number | null) => fmtBytes(value)
  },
  {
    title: '总量',
    dataIndex: 'total',
    key: 'total',
    width: 110,
    align: 'right',
    className: 'monitor-num',
    sorter: (a, b) => Number(a.total ?? 0) - Number(b.total ?? 0),
    render: (value: number | null) => fmtBytes(value)
  },
  {
    title: 'inode 使用率',
    dataIndex: 'inode_percent',
    key: 'inode_percent',
    width: 120,
    align: 'right',
    className: 'monitor-num',
    sorter: (a, b) => Number(a.inode_percent ?? 0) - Number(b.inode_percent ?? 0),
    render: (value: number | null) =>
      value == null || !Number.isFinite(value) ? '—' : value.toFixed(1) + '%'
  },
  {
    title: '读速率',
    dataIndex: 'read_rate',
    key: 'read_rate',
    width: 112,
    align: 'right',
    className: 'monitor-num',
    sorter: (a, b) => Number(a.read_rate ?? 0) - Number(b.read_rate ?? 0),
    render: (value: number | null) => fmtRate(value)
  },
  {
    title: '写速率',
    dataIndex: 'write_rate',
    key: 'write_rate',
    width: 112,
    align: 'right',
    className: 'monitor-num',
    sorter: (a, b) => Number(a.write_rate ?? 0) - Number(b.write_rate ?? 0),
    render: (value: number | null) => fmtRate(value)
  },
  {
    title: 'IOPS（读 / 写）',
    dataIndex: 'read_iops',
    key: 'iops',
    width: 140,
    align: 'right',
    className: 'monitor-num',
    sorter: (a, b) => Number(a.read_iops ?? 0) - Number(b.read_iops ?? 0),
    render: (_: unknown, row) =>
      row.read_iops == null && row.write_iops == null
        ? '—'
        : `${numberOrDash(row.read_iops)} / ${numberOrDash(row.write_iops)}`
  },
  {
    title: 'await',
    dataIndex: 'await_ms',
    key: 'await_ms',
    width: 96,
    align: 'right',
    className: 'monitor-num',
    sorter: (a, b) => Number(a.await_ms ?? 0) - Number(b.await_ms ?? 0),
    render: (value: number | null) => (value == null ? '—' : `${numberOrDash(value)} ms`)
  }
];

/**
 * 磁盘全量卡片：每个挂载点一行，不折叠、不限制条数。
 * @param props 见 {@link MonitorDiskTableProps}
 */
export default function MonitorDiskTable({ disks, live, loading }: MonitorDiskTableProps) {
  const [query, setQuery] = useState('');
  const rows = useMemo(() => filterDisks(mergeDiskRows(disks, live), query), [disks, live, query]);

  return (
    <Card
      className="monitor-card monitor-table-card"
      title="磁盘"
      extra={
        <Typography.Text type="secondary" className="monitor-num">
          共 {disks.length} 个挂载点
        </Typography.Text>
      }
    >
      <div className="monitor-table-tools">
        <Input
          allowClear
          size="small"
          placeholder="搜索挂载点 / 设备"
          aria-label="搜索挂载点或文件系统"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="monitor-table-search"
        />
      </div>
      <Table<DiskRow>
        rowKey={(row) => row.mount + row.filesystem}
        size="small"
        columns={columns}
        dataSource={rows}
        loading={loading}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: '—' }}
        pagination={false}
      />
    </Card>
  );
}
