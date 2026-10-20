/**
 * LoadStall —— 「系统」页的「负载与卡顿」区块：卡顿指数 + CPU 三档（1s/15s/60s）+
 * Top 服务（cgroup）+ 最近 15 秒 CPU 增量归因。
 *
 * 数据全部来自系统 SSE 的 `system` 段（`stall_score` / `stall_level` / `cpu` / `top_services`），
 * 组件自身不发请求、不轮询；父级只在系统 Tab 激活时渲染本区块。
 *
 * 兼容性：旧后端没有 `stall_score` / `stall_level` 时整块返回 `null`（不留空壳）；
 * 各子表为空时只隐藏对应小节。设计语言一律用 antd token，不写死色值。
 */
import { Card, Col, Row, Space, Table, Tag, Typography, theme, Badge } from 'antd';
import type { TableColumnsType } from 'antd';
import type { CpuMover, ServiceCpu, SystemData } from '../api';
import { fmtMB, fmtPct } from '../format';

/** 区块对外 props */
export interface LoadStallProps {
  /** 系统 Tab 是否激活；未激活时不渲染（父级常驻挂载，只切显隐） */
  active: boolean;
  /** 系统 SSE 快照的 `system` 段；缺失旧字段时整块不渲染 */
  data?: SystemData | null;
}

/** 档位 → antd Tag 状态色（不改色板，直接用语义状态） */
function levelColor(level: string): 'success' | 'warning' | 'error' {
  if (level === '明显卡顿') return 'error';
  if (level === '有压力') return 'warning';
  return 'success';
}

/** 百分比安全展示：非法值显示 —，否则一位小数 + %。 */
function pct(v: number | null | undefined): string {
  const s = fmtPct(v);
  return s === '—' ? s : `${s}%`;
}

/** 增量展示：正数带 +，其余保持一位小数 + %。 */
function delta(v: number | null | undefined): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}

/**
 * 「负载与卡顿」区块。
 * @param props 见 {@link LoadStallProps}
 */
export default function LoadStall({ active, data }: LoadStallProps) {
  const { token } = theme.useToken();
  const cpu = data?.cpu;
  const score = Number(data?.stall_score);
  const level = data?.stall_level;

  // 旧后端没有卡顿指数：整块不渲染，避免留下只有标题的空壳。
  if (!active || data?.stall_score == null || !Number.isFinite(score) || !level) return null;

  const psi60 = Number(data?.psi?.cpu?.some?.avg60);
  const psiText = Number.isFinite(psi60)
    ? `过去 60 秒有 ${psi60.toFixed(1)}% 的时间在等 CPU`
    : 'PSI 数据暂不可用';

  const tiers = [
    { label: '1s', value: cpu?.usage_percent },
    { label: '15s', value: cpu?.usage_15s },
    { label: '60s', value: cpu?.usage_60s }
  ];

  const services = [...(data?.top_services ?? [])]
    .filter((s): s is ServiceCpu => s != null)
    .sort((a, b) => Number(b.cpu_percent ?? 0) - Number(a.cpu_percent ?? 0))
    .slice(0, 10);
  const movers = [...(cpu?.top_movers ?? [])]
    .filter((m): m is CpuMover => m != null)
    .sort((a, b) => Number(b.delta_percent ?? 0) - Number(a.delta_percent ?? 0));

  const serviceColumns: TableColumnsType<ServiceCpu> = [
    {
      title: '单元名',
      dataIndex: 'unit',
      key: 'unit',
      render: (v: string | undefined) => <Typography.Text>{v || '—'}</Typography.Text>
    },
    {
      title: 'CPU%',
      dataIndex: 'cpu_percent',
      key: 'cpu_percent',
      align: 'right',
      render: (v: number | undefined) => pct(v)
    },
    {
      title: '内存',
      dataIndex: 'mem_mb',
      key: 'mem_mb',
      align: 'right',
      render: (v: number | null | undefined) => (v == null ? '—' : fmtMB(v))
    }
  ];

  const moverColumns: TableColumnsType<CpuMover> = [
    {
      title: '进程名',
      dataIndex: 'name',
      key: 'name',
      render: (v: string | undefined, row) => (
        <Space size={6} wrap>
          <Typography.Text>{v || '—'}</Typography.Text>
          {row.pid != null && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              #{row.pid}
            </Typography.Text>
          )}
          {row.exited && <Tag>已退出</Tag>}
        </Space>
      )
    },
    {
      title: '增量',
      dataIndex: 'delta_percent',
      key: 'delta_percent',
      align: 'right',
      render: (v: number | undefined) => delta(v)
    },
    {
      title: '当前',
      dataIndex: 'current_percent',
      key: 'current_percent',
      align: 'right',
      render: (v: number | undefined, row) =>
        row.exited ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          <Typography.Text>{pct(v)}</Typography.Text>
        )
    }
  ];

  return (
    <Card title="负载与卡顿" size="small" style={{ marginBottom: 16 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          gap: 8
        }}
      >
        <Typography.Text type="secondary">卡顿指数</Typography.Text>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {score.toFixed(1)}
        </Typography.Title>
        <Tag color={levelColor(level)}>{level}</Tag>
      </div>

      <div style={{ marginTop: 4, overflowWrap: 'anywhere' }}>
        <Badge status={levelColor(level)} text={<Typography.Text type="secondary">{psiText}</Typography.Text>} />
      </div>

      <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
        运行队列 {cpu?.run_queue ?? '—'} / {cpu?.cores ?? '—'} 核 · 15s 平均{' '}
        {pct(cpu?.usage_15s)} · 60s {pct(cpu?.usage_60s)}
      </Typography.Text>

      <div style={{ display: 'flex', gap: 12, marginTop: 12 }} aria-label="CPU 三档占用">
        {tiers.map((t) => {
          const raw = Number(t.value);
          const value = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0;
          return (
            <div
              key={t.label}
              style={{ flex: '1 1 0', minWidth: 0 }}
              title={`${t.label} 平均 ${pct(t.value)}`}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 4 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t.label}
                </Typography.Text>
                <Typography.Text style={{ fontSize: 12 }}>{pct(t.value)}</Typography.Text>
              </div>
              <div
                style={{
                  height: 6,
                  marginTop: 4,
                  borderRadius: token.borderRadiusSM,
                  background: token.colorFillSecondary,
                  overflow: 'hidden'
                }}
              >
                <div style={{ width: `${value}%`, height: '100%', background: token.colorPrimary }} />
              </div>
            </div>
          );
        })}
      </div>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        {services.length > 0 && (
          <Col xs={24} lg={12}>
            <Typography.Title level={5} style={{ margin: '0 0 8px' }}>
              Top 服务
            </Typography.Title>
            <Table<ServiceCpu>
              rowKey={(row) => row.unit || 'unknown'}
              columns={serviceColumns}
              dataSource={services}
              pagination={false}
              size="small"
              scroll={{ x: 'max-content' }}
            />
          </Col>
        )}

        {movers.length > 0 && (
          <Col xs={24} lg={12}>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 8,
                margin: '0 0 8px'
              }}
            >
              <Typography.Title level={5} style={{ margin: 0 }}>
                最近 15 秒 CPU 增量
              </Typography.Title>
              <Tag>含已退出进程</Tag>
            </div>
            <Table<CpuMover>
              rowKey={(row) => `${row.pid ?? 'pid'}-${row.name ?? 'proc'}`}
              columns={moverColumns}
              dataSource={movers}
              pagination={false}
              size="small"
              scroll={{ x: 'max-content' }}
            />
          </Col>
        )}
      </Row>
    </Card>
  );
}
