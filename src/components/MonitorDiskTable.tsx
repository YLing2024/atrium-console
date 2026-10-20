/**
 * MonitorDiskTable —— 监控页「磁盘」全量表。
 *
 * 挂载点、容量与 inode 来自 `/api/admin/system/info`（含全部真实块设备挂载点）；
 * 读写速率来自系统 SSE 的 `disks[]`，按挂载点与 filesystem 合并。任一来源缺失时
 * 对应单元格显示破折号，不伪造 0。
 */
import { useMemo, useState } from 'react';
import { Card, Input, Table, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import type { DiskInfo, SystemDiskInfo } from '../api';
import { fmtBytes, fmtRate } from '../format';
import { filterDisks, mergeDiskRows, type DiskRow } from '../monitorTable';

export interface MonitorDiskTableProps {
  /** `/api/admin/system/info` 的 disks（含 inode） */
  disks: SystemDiskInfo[];
  /** 系统 SSE 的 disks（含读写速率；可缺） */
  live?: DiskInfo[];
  loading?: boolean;
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
    title: '文件系统',
    dataIndex: 'filesystem',
    key: 'filesystem',
    ellipsis: true,
    sorter: (a, b) => a.filesystem.localeCompare(b.filesystem)
  },
  {
    title: '类型',
    dataIndex: 'fstype',
    key: 'fstype',
    width: 88,
    sorter: (a, b) => a.fstype.localeCompare(b.fstype)
  },
  {
    title: '已用 / 总量',
    dataIndex: 'used',
    key: 'used',
    width: 170,
    align: 'right',
    className: 'monitor-num',
    sorter: (a, b) => Number(a.used ?? 0) - Number(b.used ?? 0),
    render: (_: unknown, row) =>
      row.used == null || row.total == null ? '—' : `${fmtBytes(row.used)} / ${fmtBytes(row.total)}`
  },
  {
    title: '使用率',
    dataIndex: 'percent',
    key: 'percent',
    width: 96,
    align: 'right',
    className: 'monitor-num',
    sorter: (a, b) => Number(a.percent ?? 0) - Number(b.percent ?? 0),
    render: (value: number | null) => (value == null ? '—' : value.toFixed(1) + '%')
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
    title: 'inode 已用 / 总量',
    dataIndex: 'inode_used',
    key: 'inode_used',
    width: 150,
    align: 'right',
    className: 'monitor-num',
    sorter: (a, b) => Number(a.inode_used ?? 0) - Number(b.inode_used ?? 0),
    render: (_: unknown, row) =>
      row.inode_total == null || row.inode_total === 0
        ? '—'
        : `${row.inode_used ?? 0} / ${row.inode_total}`
  },
  {
    title: '读',
    dataIndex: 'read_rate',
    key: 'read_rate',
    width: 112,
    align: 'right',
    className: 'monitor-num',
    sorter: (a, b) => Number(a.read_rate ?? 0) - Number(b.read_rate ?? 0),
    render: (value: number | null) => fmtRate(value)
  },
  {
    title: '写',
    dataIndex: 'write_rate',
    key: 'write_rate',
    width: 112,
    align: 'right',
    className: 'monitor-num',
    sorter: (a, b) => Number(a.write_rate ?? 0) - Number(b.write_rate ?? 0),
    render: (value: number | null) => fmtRate(value)
  }
];

/**
 * 磁盘全量卡片。
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
        pagination={{
          defaultPageSize: 20,
          showSizeChanger: true,
          pageSizeOptions: ['20', '50', '100'],
          showTotal: (count) => `共 ${count} 条`,
          size: 'small'
        }}
      />
    </Card>
  );
}
