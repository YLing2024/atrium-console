/**
 * MetricsDetail —— 指标下钻页 `/metrics/:key`。
 *
 * 一张大图 + 分位数统计 + 该指标的基线异常点。
 * 与趋势区共用同一份 /api/admin/system/metrics 数据，但给足高度与标注。
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Empty, Segmented, Space, Statistic, Table, Tag, Typography, theme } from 'antd';
import { navigate } from '../router';
import Chart, { type EChartsOption } from '../components/Chart';
import { getSystemMetrics, request, type HistoryPoint } from '../api';
import { MONITOR_RANGES, type MonitorRange } from '../monitor';

interface Anomaly {
  ts: string;
  metric: string;
  value: number;
  mean: number;
  stddev: number;
  z: number;
}

/** 指标配置：与趋势四图一致。 */
const SPECS: Record<string, { title: string; unit: string; fields: string[]; labels: string[] }> = {
  cpu: { title: 'CPU 使用率', unit: '%', fields: ['cpu'], labels: ['CPU'] },
  mem: { title: '内存使用率', unit: '%', fields: ['mem_percent'], labels: ['内存'] },
  disk: { title: '磁盘使用率', unit: '%', fields: ['disk_percent'], labels: ['磁盘'] },
  net: {
    title: '网络吞吐',
    unit: 'B/s',
    fields: ['net_rx_rate', 'net_tx_rate'],
    labels: ['下行', '上行']
  }
};

/** 与后端 anomaly_events.metric 的命名对齐。 */
const ANOMALY_KEY: Record<string, string> = {
  cpu: 'cpu_percent',
  mem: 'mem_percent',
  disk: 'disk_percent',
  net: 'net_rx_rate'
};

function fmtRate(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB/s`;
  if (v >= 1024) return `${(v / 1024).toFixed(0)} KB/s`;
  return `${Math.round(v)} B/s`;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

export default function MetricsDetail({ metric }: { metric: string }) {
  const spec = SPECS[metric] ?? SPECS.cpu;
  const { token } = theme.useToken();
  const [range, setRange] = useState<MonitorRange>('1h');
  const [points, setPoints] = useState<HistoryPoint[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const res = await getSystemMetrics(range, 'auto');
        if (alive) setPoints(res.points ?? []);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [range]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await request<{ items: Anomaly[] }>('/api/admin/anomalies?limit=200');
        if (alive) setAnomalies(res.items ?? []);
      } catch {
        /* 异常接口失败不影响主图 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const values = useMemo(() => {
    const field = spec.fields[0];
    return points
      .map((p) => (typeof p[field] === 'number' ? (p[field] as number) : null))
      .filter((v): v is number => v != null);
  }, [points, spec]);

  const stats = useMemo(() => {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    return {
      avg: sum / values.length,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      max: sorted[sorted.length - 1],
      current: values[values.length - 1]
    };
  }, [values]);

  const mine = anomalies.filter((a) => a.metric === ANOMALY_KEY[metric]);

  const option: EChartsOption = useMemo(() => {
    const labels = points.map((p) => {
      const d = new Date(p.ts);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    });
    const colors = [token.colorPrimary, token.colorSuccess];
    return {
      animation: false,
      grid: { left: 12, right: 16, top: 24, bottom: 32, containLabel: true },
      tooltip: {
        trigger: 'axis',
        valueFormatter: (v: unknown) =>
          spec.unit === 'B/s' ? fmtRate(Number(v)) : `${Number(v).toFixed(1)}%`
      },
      legend: { show: spec.fields.length > 1, top: 0, right: 0, textStyle: { fontSize: 11 } },
      xAxis: {
        type: 'category',
        data: labels,
        boundaryGap: false,
        axisLabel: { fontSize: 10, color: token.colorTextTertiary, interval: 'auto' }
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          fontSize: 10,
          color: token.colorTextTertiary,
          formatter: (v: number) => (spec.unit === 'B/s' ? fmtRate(v) : `${v}%`)
        },
        splitLine: { lineStyle: { color: token.colorSplit, type: 'dashed' } }
      },
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 4 }],
      series: spec.fields.map((field, i) => ({
        name: spec.labels[i],
        type: 'line' as const,
        smooth: 0.2,
        symbol: 'none',
        lineStyle: { width: 1.6 },
        areaStyle: { opacity: 0.08 },
        itemStyle: { color: colors[i] },
        data: points.map((p) => (typeof p[field] === 'number' ? (p[field] as number) : null))
      }))
    };
  }, [points, spec, token]);

  return (
    <div className="metrics-detail">
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Space align="center" size={12} wrap>
          <Button type="link" onClick={() => navigate('/system')} style={{ paddingLeft: 0 }}>
            ‹ 系统监控
          </Button>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {spec.title}
          </Typography.Title>
          <Segmented
            size="small"
            value={range}
            onChange={(v) => setRange(v as MonitorRange)}
            options={MONITOR_RANGES.map((r) => ({ label: r.label, value: r.id }))}
          />
        </Space>

        <Card title="走势" loading={loading}>
          {points.length === 0 && !loading ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
          ) : (
            <Chart height={360} option={option} />
          )}
        </Card>

        <Card title="统计">
          {stats ? (
            <Space size={40} wrap>
              <Statistic title="当前" value={spec.unit === 'B/s' ? fmtRate(stats.current) : stats.current.toFixed(1) + '%'} />
              <Statistic title="均值" value={spec.unit === 'B/s' ? fmtRate(stats.avg) : stats.avg.toFixed(1) + '%'} />
              <Statistic title="P50" value={spec.unit === 'B/s' ? fmtRate(stats.p50) : stats.p50.toFixed(1) + '%'} />
              <Statistic title="P95" value={spec.unit === 'B/s' ? fmtRate(stats.p95) : stats.p95.toFixed(1) + '%'} />
              <Statistic title="峰值" value={spec.unit === 'B/s' ? fmtRate(stats.max) : stats.max.toFixed(1) + '%'} />
            </Space>
          ) : (
            <Typography.Text type="secondary">—</Typography.Text>
          )}
        </Card>

        <Card
          title="异常点"
          extra={
            <Typography.Text type="secondary">
              与本指标历史基线偏离 &gt; 4σ 的时刻（{mine.length} 条）
            </Typography.Text>
          }
        >
          <Table<Anomaly>
            size="small"
            rowKey={(r) => r.ts + r.metric}
            dataSource={mine}
            pagination={false}
            scroll={{ y: 240 }}
            locale={{ emptyText: '该指标暂无异常记录' }}
            columns={[
              {
                title: '时间',
                dataIndex: 'ts',
                width: 200,
                render: (v: string) => <span className="monitor-num">{new Date(v).toLocaleString()}</span>
              },
              {
                title: '值',
                dataIndex: 'value',
                width: 120,
                render: (v: number) => (spec.unit === 'B/s' ? fmtRate(v) : `${v.toFixed(1)}%`)
              },
              { title: '基线均值', dataIndex: 'mean', width: 120, render: (v: number) => v.toFixed(1) },
              {
                title: '偏离',
                dataIndex: 'z',
                width: 100,
                render: (v: number) => <Tag color={Math.abs(v) > 6 ? 'error' : 'warning'}>{v.toFixed(1)}σ</Tag>
              }
            ]}
          />
        </Card>
      </Space>
    </div>
  );
}
