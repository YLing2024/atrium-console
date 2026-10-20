/**
 * MonitorContainers —— docker 容器表。
 *
 * 数据来自系统 SSE 帧的 `containers`（后端 `docker ps -a` + `docker stats` 合并，5 秒缓存）。
 * 与其它表一致：固定高度滚动、表头吸顶、数值列可排序、支持搜索。
 */
import { useMemo, useState } from 'react';
import { Card, Input, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import type { ContainerStat } from '../api';
import { fmtMB, fmtPct } from '../format';

interface Props {
  containers: ContainerStat[];
  loading?: boolean;
}

/** 状态 → Tag 颜色：运行中绿、暂停橙、退出灰红。 */
function stateColor(state?: string): string {
  switch ((state || '').toLowerCase()) {
    case 'running':
      return 'success';
    case 'paused':
      return 'warning';
    case 'exited':
    case 'dead':
      return 'error';
    default:
      return 'default';
  }
}

// 统一走 format.ts：MB 超 1024 自动升 GB，百分比一位小数，整数带千分位。
const fmt1 = (v?: number) => fmtPct(v);
const fmtInt = (v?: number) => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));

export default function MonitorContainers({ containers, loading }: Props) {
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return containers;
    return containers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) || (c.image || '').toLowerCase().includes(q)
    );
  }, [containers, query]);

  const columns: TableColumnsType<ContainerStat> = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      fixed: 'left',
      width: 180,
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (v: string) => <Typography.Text strong>{v}</Typography.Text>
    },
    {
      title: '状态',
      dataIndex: 'state',
      key: 'state',
      width: 100,
      render: (v: string) => <Tag color={stateColor(v)}>{v || '—'}</Tag>
    },
    {
      title: 'CPU',
      dataIndex: 'cpu_percent',
      key: 'cpu_percent',
      width: 90,
      align: 'right',
      sorter: (a, b) => (a.cpu_percent ?? 0) - (b.cpu_percent ?? 0),
      sortDirections: ['descend', 'ascend'],
      render: (v?: number) => fmt1(v)
    },
    {
      title: '内存',
      dataIndex: 'mem_mb',
      key: 'mem_mb',
      width: 130,
      align: 'right',
      sorter: (a, b) => (a.mem_mb ?? 0) - (b.mem_mb ?? 0),
      sortDirections: ['descend', 'ascend'],
      render: (_, row) =>
        row.mem_mb == null ? '—' : `${fmtMB(row.mem_mb)} / ${fmtMB(row.mem_limit_mb)}`
    },
    {
      title: '网络 ↓/↑',
      dataIndex: 'net_rx_mb',
      key: 'net_rx_mb',
      width: 150,
      align: 'right',
      sorter: (a, b) => (a.net_rx_mb ?? 0) - (b.net_rx_mb ?? 0),
      render: (_, row) => `${fmtMB(row.net_rx_mb)} / ${fmtMB(row.net_tx_mb)}`
    },
    {
      title: '磁盘 ↓/↑',
      dataIndex: 'block_read_mb',
      key: 'block_read_mb',
      width: 150,
      align: 'right',
      sorter: (a, b) => (a.block_read_mb ?? 0) - (b.block_read_mb ?? 0),
      render: (_, row) => `${fmtMB(row.block_read_mb)} / ${fmtMB(row.block_write_mb)}`
    },
    {
      title: 'PIDs',
      dataIndex: 'pids',
      key: 'pids',
      width: 80,
      align: 'right',
      sorter: (a, b) => (a.pids ?? 0) - (b.pids ?? 0),
      render: (v?: number) => fmtInt(v)
    }
  ];

  return (
    <Card
      className="monitor-card monitor-table-card"
      title="容器"
      extra={
        <Typography.Text type="secondary" className="monitor-num">
          共 {containers.length} 个容器
        </Typography.Text>
      }
    >
      <div className="monitor-table-tools">
        <Input
          allowClear
          size="small"
          placeholder="搜索容器名 / 镜像"
          aria-label="搜索容器名或镜像"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="monitor-table-search"
        />
      </div>
      <Table<ContainerStat>
        rowKey={(row) => row.name}
        size="small"
        columns={columns}
        dataSource={rows}
        loading={loading}
        scroll={{ x: 'max-content', y: 320 }}
        pagination={false}
        locale={{ emptyText: '—' }}
        rowClassName={(row) => (row.state === 'running' ? '' : 'monitor-row-muted')}
      />
    </Card>
  );
}
