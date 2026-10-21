/**
 * MonitorPortTable —— 监控页「端口」全量表。
 *
 * 数据来自 `/api/admin/system/info` 的 `ports.items`（默认全量 TCP + UDP 监听项）。
 * 过滤档位：全部 / TCP / UDP / 仅监听（只留 state=LISTEN 的 TCP 行）；
 * 搜索端口、进程名与监听地址；端口列默认升序，数值列按数值排序。
 */
import { useMemo, useState } from 'react';
import { Card, Input, Segmented, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import type { SystemPortInfo } from '../api';
import { filterPorts, type PortFilter } from '../monitorTable';

export interface MonitorPortTableProps {
  /** 全部监听项 */
  ports: SystemPortInfo[];
  /** 采集失败时的灰色说明；有值时表格为空 */
  error?: string;
  loading?: boolean;
}

const columns: TableColumnsType<SystemPortInfo> = [
  {
    title: '端口',
    dataIndex: 'port',
    key: 'port',
    width: 88,
    align: 'right',
    className: 'monitor-num',
    defaultSortOrder: 'ascend',
    sorter: (a, b) => Number(a.port ?? 0) - Number(b.port ?? 0),
    render: (value: number | undefined) => (value == null ? '—' : String(value))
  },
  {
    title: '协议',
    dataIndex: 'protocol',
    key: 'protocol',
    width: 80,
    sorter: (a, b) => String(a.protocol || '').localeCompare(String(b.protocol || '')),
    render: (value: string | undefined) => <Tag>{value || '—'}</Tag>
  },
  {
    title: '状态',
    dataIndex: 'state',
    key: 'state',
    width: 96,
    sorter: (a, b) => String(a.state || '').localeCompare(String(b.state || '')),
    render: (value: string | undefined) => value || '—'
  },
  {
    title: '进程',
    dataIndex: 'process',
    key: 'process',
    ellipsis: true,
    sorter: (a, b) => String(a.process || '').localeCompare(String(b.process || '')),
    render: (value: string | undefined) => (
      <Typography.Text ellipsis={{ tooltip: value }}>{value || '—'}</Typography.Text>
    )
  },
  {
    title: 'PID',
    dataIndex: 'pid',
    key: 'pid',
    width: 88,
    align: 'right',
    className: 'monitor-num',
    sorter: (a, b) => Number(a.pid ?? 0) - Number(b.pid ?? 0),
    render: (value: number | null | undefined) => (value == null ? '—' : String(value))
  },
  {
    title: '监听地址',
    dataIndex: 'address',
    key: 'address',
    ellipsis: true,
    sorter: (a, b) => String(a.address || '').localeCompare(String(b.address || '')),
    render: (value: string | undefined) => (
      <Typography.Text ellipsis={{ tooltip: value }}>{value || '—'}</Typography.Text>
    )
  }
];

/**
 * 端口全量卡片。
 * @param props 见 {@link MonitorPortTableProps}
 */
export default function MonitorPortTable({ ports, error, loading }: MonitorPortTableProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PortFilter>('all');
  const rows = useMemo(() => filterPorts(ports, filter, query), [ports, filter, query]);

  return (
    <Card
      className="monitor-card monitor-table-card"
      title="端口"
      extra={
        <Typography.Text type="secondary" className="monitor-num">
          共 {ports.length} 条
        </Typography.Text>
      }
    >
      <div className="monitor-table-tools">
        <Segmented
          size="small"
          value={filter}
          onChange={(value) => setFilter(String(value) as PortFilter)}
          options={[
            { label: '全部', value: 'all' },
            { label: 'TCP', value: 'tcp' },
            { label: 'UDP', value: 'udp' },
            { label: '仅监听', value: 'listen' }
          ]}
        />
        <Input
          allowClear
          size="small"
          placeholder="搜索端口 / 进程 / 地址"
          aria-label="搜索端口、进程或监听地址"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="monitor-table-search"
        />
      </div>
      {error ? (
        <Typography.Text type="secondary" className="monitor-audit-note">
          {error}
        </Typography.Text>
      ) : (
        <Table<SystemPortInfo>
          rowKey={(row, index) => `${row.protocol || 'tcp'}-${row.port || 0}-${row.pid || 0}-${index}`}
          size="small"
          columns={columns}
          dataSource={rows}
          loading={loading}
          virtual
          scroll={{ x: 'max-content', y: 420 }}
          locale={{ emptyText: '—' }}
          pagination={false}
        />
      )}
    </Card>
  );
}
