/**
 * MonitorProcessTable —— 监控页「进程」全量表。
 *
 * 数据来自父级每 5s 拉取的 `GET /api/admin/services`（全量进程树，含线程数与 cgroup 内存）。
 * 本组件不截断行数：搜索 / 排序 / 分页全部在本地完成，默认按 CPU 降序。
 * 列可见性用「列」按钮的复选框控制，至少保留名称列，避免出现无法识别的空表。
 */
import { useMemo, useState } from 'react';
import { Button, Card, Checkbox, Input, Popover, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import type { ProcessInfo } from '../api';
import { fmtMB, fmtPct } from '../format';
import { filterProcesses } from '../monitorTable';

export interface MonitorProcessTableProps {
  /** `/api/admin/services` 的 processes（全量，未截断） */
  processes: ProcessInfo[];
  /** 服务端 `count`（截断前总数）；缺省时用数组长度 */
  total?: number;
  /** 是否已拿到首帧；空数组时用于区分「加载中」与「真的没有进程」 */
  loading?: boolean;
}

type ProcessColumnKey = 'name' | 'pid' | 'cpu' | 'mem_mb' | 'thread_count' | 'cgroup_mem_mb' | 'subtree_mem_mb';

const COLUMN_LABELS: Record<ProcessColumnKey, string> = {
  name: '名称',
  pid: 'PID',
  cpu: 'CPU',
  mem_mb: '内存',
  thread_count: '线程',
  cgroup_mem_mb: 'cgroup 内存',
  subtree_mem_mb: '子树内存'
};

const allColumns: TableColumnsType<ProcessInfo> = [
  {
    title: '名称',
    dataIndex: 'name',
    key: 'name',
    ellipsis: true,
    sorter: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
    render: (value: string | undefined) => (
      <Typography.Text ellipsis={{ tooltip: value }}>{value || '—'}</Typography.Text>
    )
  },
  {
    title: 'PID',
    dataIndex: 'pid',
    key: 'pid',
    width: 80,
    align: 'right',
    className: 'monitor-num',
    sorter: (a, b) => Number(a.pid) - Number(b.pid)
  },
  {
    title: 'CPU',
    dataIndex: 'cpu',
    key: 'cpu',
    width: 88,
    align: 'right',
    className: 'monitor-num',
    defaultSortOrder: 'descend',
    sorter: (a, b) => Number(a.cpu ?? 0) - Number(b.cpu ?? 0),
    render: (value: number | undefined) =>
      value == null || !Number.isFinite(Number(value)) ? '—' : fmtPct(value) + '%'
  },
  {
    title: '内存',
    dataIndex: 'mem_mb',
    key: 'mem_mb',
    width: 100,
    align: 'right',
    className: 'monitor-num',
    sorter: (a, b) => Number(a.mem_mb ?? 0) - Number(b.mem_mb ?? 0),
    render: (value: number | undefined) => fmtMB(value)
  },
  {
    title: '线程',
    dataIndex: 'thread_count',
    key: 'thread_count',
    width: 80,
    align: 'right',
    className: 'monitor-num',
    sorter: (a, b) => Number(a.thread_count ?? 0) - Number(b.thread_count ?? 0),
    render: (value: number | null | undefined) => (value == null ? '—' : String(value))
  },
  {
    title: 'cgroup 内存',
    dataIndex: 'cgroup_mem_mb',
    key: 'cgroup_mem_mb',
    width: 112,
    align: 'right',
    className: 'monitor-num',
    sorter: (a, b) => Number(a.cgroup_mem_mb ?? 0) - Number(b.cgroup_mem_mb ?? 0),
    render: (value: number | null | undefined) => (value == null ? '—' : fmtMB(value))
  },
  {
    title: '子树内存',
    dataIndex: 'subtree_mem_mb',
    key: 'subtree_mem_mb',
    width: 100,
    align: 'right',
    className: 'monitor-num',
    sorter: (a, b) => Number(a.subtree_mem_mb ?? 0) - Number(b.subtree_mem_mb ?? 0),
    render: (value: number | undefined) => fmtMB(value)
  }
];

/**
 * 进程全量卡片。
 * @param props 见 {@link MonitorProcessTableProps}
 */
export default function MonitorProcessTable({ processes, total, loading }: MonitorProcessTableProps) {
  const [query, setQuery] = useState('');
  const [hidden, setHidden] = useState<Set<ProcessColumnKey>>(new Set());

  const rows = useMemo(() => filterProcesses(processes, query), [processes, query]);
  const columns = useMemo(
    () => allColumns.filter((column) => !hidden.has(column.key as ProcessColumnKey)),
    [hidden]
  );
  const totalCount = total ?? processes.length;

  function toggleColumn(key: ProcessColumnKey, checked: boolean) {
    if (key === 'name') return;
    setHidden((prev) => {
      const next = new Set(prev);
      if (checked) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const columnMenu = (
    <div className="monitor-column-menu">
      {(Object.keys(COLUMN_LABELS) as ProcessColumnKey[]).map((key) => (
        <Checkbox
          key={key}
          checked={!hidden.has(key)}
          disabled={key === 'name'}
          onChange={(event) => toggleColumn(key, event.target.checked)}
        >
          {COLUMN_LABELS[key]}
        </Checkbox>
      ))}
    </div>
  );

  return (
    <Card
      className="monitor-card monitor-table-card"
      title="进程"
      extra={
        <Typography.Text type="secondary" className="monitor-num">
          共 {totalCount} 个进程
        </Typography.Text>
      }
    >
      <div className="monitor-table-tools">
        <Input
          allowClear
          size="small"
          placeholder="搜索名称 / PID"
          aria-label="搜索进程名称或 PID"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="monitor-table-search"
        />
        <Popover content={columnMenu} trigger="click" placement="bottomRight">
          <Button size="small" icon={<SettingOutlined />}>
            列
          </Button>
        </Popover>
      </div>
      <Table<ProcessInfo>
        rowKey={(row) => String(row.pid)}
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
      {rows.length === 0 && !loading && processes.length > 0 && (
        <Tag className="monitor-table-empty-tag">没有匹配的进程</Tag>
      )}
    </Card>
  );
}
