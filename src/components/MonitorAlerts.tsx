/**
 * MonitorAlerts —— 告警规则与最近事件。
 *
 * 规则由后端每分钟判定一次（连续满足 durationSec 才触发，cooldownSec 内不重复推送）。
 * 这里只做「看 + 启停」，新建规则走 API（避免在监控页塞一个复杂表单）。
 */
import { useCallback, useEffect, useState } from 'react';
import { Card, Empty, Space, Switch, Table, Tag, Typography, message } from 'antd';
import type { TableColumnsType } from 'antd';
import { request } from '../api';

interface Rule {
  id: number;
  name: string;
  metric: string;
  op: string;
  threshold: number;
  durationSec: number;
  severity: string;
  enabled: boolean;
  cooldownSec: number;
}

interface Event {
  id: number;
  ruleName: string;
  severity: string;
  value: number;
  threshold: number;
  startedAt: string;
  endedAt?: string;
  notified: boolean;
}

const METRIC_LABEL: Record<string, string> = {
  cpu_percent: 'CPU',
  mem_percent: '内存',
  disk_percent: '磁盘',
  stall_score: '卡顿指数',
  run_queue: '运行队列',
  psi_cpu: 'PSI CPU',
  psi_io: 'PSI IO',
  psi_mem: 'PSI 内存'
};

const OP_LABEL: Record<string, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤' };

function severityColor(s: string): string {
  return s === 'crit' ? 'error' : s === 'warn' ? 'warning' : 'default';
}

export default function MonitorAlerts() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, e] = await Promise.all([
        request<{ items: Rule[] }>('/api/admin/alerts/rules'),
        request<{ items: Event[] }>('/api/admin/alerts/events?limit=20')
      ]);
      setRules(r.items ?? []);
      setEvents(e.items ?? []);
    } catch {
      /* 告警未启用时静默降级 */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(rule: Rule, enabled: boolean) {
    try {
      await request(`/api/admin/alerts/rules/${rule.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled })
      });
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled } : r)));
    } catch (err) {
      message.error((err as Error).message);
    }
  }

  const columns: TableColumnsType<Rule> = [
    { title: '规则', dataIndex: 'name', width: 160, ellipsis: true },
    {
      title: '条件',
      key: 'cond',
      width: 190,
      render: (_, r) =>
        `${METRIC_LABEL[r.metric] ?? r.metric} ${OP_LABEL[r.op] ?? r.op} ${r.threshold}`
    },
    {
      title: '持续',
      dataIndex: 'durationSec',
      width: 90,
      render: (v: number) => `${Math.round(v / 60)} 分钟`
    },
    {
      title: '级别',
      dataIndex: 'severity',
      width: 80,
      render: (v: string) => <Tag color={severityColor(v)}>{v}</Tag>
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 80,
      render: (v: boolean, r) => <Switch size="small" checked={v} onChange={(c) => toggle(r, c)} />
    }
  ];

  return (
    <Card
      className="monitor-card"
      title="告警"
      loading={loading}
      extra={
        <Typography.Text type="secondary" className="monitor-num">
          {rules.length} 条规则 · 最近 {events.length} 次触发
        </Typography.Text>
      }
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Table<Rule>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={rules}
          pagination={false}
          locale={{ emptyText: '暂无规则' }}
        />

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          最近触发
        </Typography.Text>
        {events.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有触发记录" />
        ) : (
          <Table<Event>
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={events}
            scroll={{ y: 220 }}
            columns={[
              {
                title: '时间',
                dataIndex: 'startedAt',
                width: 180,
                render: (v: string) => (
                  <span className="monitor-num">{new Date(v).toLocaleString()}</span>
                )
              },
              { title: '规则', dataIndex: 'ruleName', ellipsis: true },
              {
                title: '值 / 阈值',
                key: 'v',
                width: 140,
                render: (_, e) => `${e.value.toFixed(1)} / ${e.threshold}`
              },
              {
                title: '已推送',
                dataIndex: 'notified',
                width: 90,
                render: (v: boolean) => (v ? <Tag color="success">是</Tag> : <Tag>否</Tag>)
              }
            ]}
          />
        )}
      </Space>
    </Card>
  );
}
