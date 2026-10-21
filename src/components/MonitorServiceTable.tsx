/**
 * MonitorServiceTable —— 监控页「服务」全量表。
 *
 * 数据来自 `GET /api/admin/system/services`：全部 running 的 `.service` 单元，
 * 含 cgroup CPU、内存与启动时间。默认按 CPU 降序，可按 CPU / 内存 / 名称 / 启动时间排序；
 * 搜索按单元名，本地过滤后分页。
 */
import { useMemo, useState } from 'react';
import { Card, Input, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import type { SystemServiceInfo } from '../api';
import { fmtDateTime, fmtMB, fmtPct } from '../format';
import { filterServices } from '../monitorTable';

export interface MonitorServiceTableProps {
  /** 全部运行中单元 */
  services: SystemServiceInfo[];
  loading?: boolean;
}

const columns: TableColumnsType<SystemServiceInfo> = [
  {
    title: '单元',
    dataIndex: 'unit',
    key: 'unit',
    ellipsis: true,
    sorter: (a, b) => String(a.unit || '').localeCompare(String(b.unit || '')),
    render: (value: string | undefined) => (
      <Typography.Text ellipsis={{ tooltip: value }}>{value || '—'}</Typography.Text>
    )
  },
  {
    title: '状态',
    dataIndex: 'active',
    key: 'active',
    width: 96,
    sorter: (a, b) => String(a.active || '').localeCompare(String(b.active || '')),
    render: (value: string | undefined) => (
      <Tag color={value === 'active' ? 'success' : 'default'}>{value || '—'}</Tag>
    )
  },
  {
    title: 'CPU',
    dataIndex: 'cpu_percent',
    key: 'cpu_percent',
    width: 88,
    align: 'right',
    className: 'monitor-num',
    defaultSortOrder: 'descend',
    sorter: (a, b) => Number(a.cpu_percent ?? 0) - Number(b.cpu_percent ?? 0),
    render: (value: number | undefined) =>
      value == null || !Number.isFinite(Number(value)) ? '—' : fmtPct(value) + '%'
  },
  {
    title: '内存',
    dataIndex: 'mem_mb',
    key: 'mem_mb',
    width: 104,
    align: 'right',
    className: 'monitor-num',
    sorter: (a, b) => Number(a.mem_mb ?? 0) - Number(b.mem_mb ?? 0),
    render: (value: number | null | undefined) => (value == null ? '—' : fmtMB(value))
  },
  {
    title: '启动时间',
    dataIndex: 'since',
    key: 'since',
    width: 160,
    align: 'right',
    className: 'monitor-num',
    sorter: (a, b) => Number(a.since ?? 0) - Number(b.since ?? 0),
    render: (value: number | undefined) => (value ? fmtDateTime(value * 1000) : '—')
  }
];

/**
 * 服务全量卡片。
 * @param props 见 {@link MonitorServiceTableProps}
 */
export default function MonitorServiceTable({ services, loading }: MonitorServiceTableProps) {
  const [query, setQuery] = useState('');
  const rows = useMemo(() => filterServices(services, query), [services, query]);

  return (
    <Card
      className="monitor-card monitor-table-card"
      title="服务"
      extra={
        <Typography.Text type="secondary" className="monitor-num">
          共 {services.length} 个服务
        </Typography.Text>
      }
    >
      <div className="monitor-table-tools">
        <Input
          allowClear
          size="small"
          placeholder="搜索单元名"
          aria-label="搜索 systemd 单元名"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="monitor-table-search"
        />
      </div>
      <Table<SystemServiceInfo>
        rowKey={(row) => row.unit || 'unknown'}
        size="small"
        columns={columns}
        dataSource={rows}
        loading={loading}
        virtual
          scroll={{ x: 'max-content', y: 420 }}
        locale={{ emptyText: '—' }}
        pagination={false}
      />
    </Card>
  );
}
