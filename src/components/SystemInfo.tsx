/**
 * SystemInfo —— 「系统」页的「系统信息」区块：概要行 + 内存/磁盘/端口服务三卡 + Top 进程 +
 * 失败单元 + 最近登录。
 *
 * 数据源与刷新纪律：
 * - 静态概况 `GET /api/admin/system/info` 每 60s 刷新（后端同样缓存 60s）；
 * - Top 进程 `GET /api/admin/system/processes` 每 10s 刷新（后端实时采样 500ms）；
 * - 页面隐藏（`document.hidden`）时停止定时器并中止在途请求，回到前台立即拉一次再恢复轮询，
 *   保证不会出现重复定时器或后台空转；
 * - 两个接口互不影响：任一块失败只显示自己的提示，不清空其它已渲染内容。
 *
 * 交互：三张小编卡片可点击（鼠标 / Enter / Space）打开 Drawer 看明细；Top 表默认 8 行，
 * 移动端表格横向滚动，卡片纵向堆叠。设计语言一律 antd 默认 token，不引第三方依赖。
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  Card,
  Col,
  Descriptions,
  Drawer,
  Progress,
  Row,
  Space,
  Spin,
  Table,
  Tag,
  Typography
} from 'antd';
import type { TableColumnsType } from 'antd';
import { getSystemInfo, getTopProcesses } from '../api';
import type {
  FailedUnitInfo,
  SystemDiskInfo,
  SystemInfoResponse,
  SystemLoginInfo,
  SystemPortInfo,
  TopProcessInfo
} from '../api';
import { fmtBytes, fmtDuration } from '../format';

const INFO_REFRESH_MS = 60000;
const PROCESS_REFRESH_MS = 10000;
const PROCESS_ROWS = 8;

type DetailKey = 'memory' | 'disk' | 'ports';

const DETAIL_TITLES: Record<DetailKey, string> = {
  memory: '内存明细',
  disk: '磁盘明细',
  ports: '端口与服务'
};

/**
 * 键值明细行。
 * @param label 左侧标签
 * @param value 右侧值（可换行）
 */
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '3px 0' }}>
      <Typography.Text type="secondary" style={{ flexShrink: 0 }}>
        {label}
      </Typography.Text>
      <Typography.Text style={{ textAlign: 'right', overflowWrap: 'anywhere' }}>{value}</Typography.Text>
    </div>
  );
}

/** 字节字段的安全展示：缺失或非法时显示 —。 */
function bytes(v: number | null | undefined): string {
  return v == null || !Number.isFinite(Number(v)) ? '—' : fmtBytes(v);
}

/** 百分比展示：保留一位小数；缺失显示 —。 */
function percent(v: number | null | undefined): string {
  return v == null || !Number.isFinite(Number(v)) ? '—' : `${Number(v).toFixed(1)}%`;
}

/**
 * 系统信息区块。
 * @param active 系统 Tab 是否激活；为 false 时不请求、不保留定时器（父级常驻挂载，仅切换显隐）
 */
export default function SystemInfo({ active }: { active: boolean }) {
  const [info, setInfo] = useState<SystemInfoResponse | null>(null);
  const [infoError, setInfoError] = useState('');
  const [processes, setProcesses] = useState<TopProcessInfo[]>([]);
  const [processError, setProcessError] = useState('');
  const [detail, setDetail] = useState<DetailKey | null>(null);

  // 静态概况：激活时立即拉一次，之后每 60s；隐藏即停表并中止在途请求。
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let ctrl: AbortController | null = null;

    const load = async () => {
      const current = new AbortController();
      ctrl?.abort();
      ctrl = current;
      try {
        const data = await getSystemInfo({ signal: current.signal });
        if (disposed || ctrl !== current) return;
        setInfo(data);
        setInfoError('');
      } catch {
        if (disposed || current.signal.aborted) return;
        setInfoError('系统概况加载失败');
      }
    };
    const start = () => {
      if (timer !== null) return;
      load();
      timer = setInterval(load, INFO_REFRESH_MS);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      ctrl?.abort();
      ctrl = null;
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [active]);

  // Top 进程：激活时立即拉一次，之后每 10s；页面隐藏同样停表，避免后台请求翻倍。
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let ctrl: AbortController | null = null;

    const load = async () => {
      const current = new AbortController();
      ctrl?.abort();
      ctrl = current;
      try {
        const data = await getTopProcesses({ signal: current.signal });
        if (disposed || ctrl !== current) return;
        setProcesses(Array.isArray(data.processes) ? data.processes : []);
        setProcessError(data.error || '');
      } catch {
        if (disposed || current.signal.aborted) return;
        setProcessError('进程数据加载失败');
      }
    };
    const start = () => {
      if (timer !== null) return;
      load();
      timer = setInterval(load, PROCESS_REFRESH_MS);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      ctrl?.abort();
      ctrl = null;
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [active]);

  const memory = info?.memory || {};
  const swap = info?.swap || {};
  const disks: SystemDiskInfo[] = Array.isArray(info?.disks) ? info.disks : [];
  const ports: SystemPortInfo[] = Array.isArray(info?.ports?.items) ? info.ports.items : [];
  const portTotal = info?.ports?.total == null ? ports.length : Number(info.ports.total);
  const failed: FailedUnitInfo[] = Array.isArray(info?.systemd?.failed) ? info.systemd.failed : [];
  const logins: SystemLoginInfo[] = Array.isArray(info?.logins?.items) ? info.logins.items : [];

  const loadText = Array.isArray(info?.load)
    ? info.load
        .slice(0, 3)
        .map((v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '—'))
        .join(' / ')
    : '—';
  const memTotal = memory.total;
  const memUsed = memory.used;
  const memPct =
    memTotal != null && memUsed != null && Number(memTotal) > 0
      ? Math.max(0, Math.min(100, (Number(memUsed) / Number(memTotal)) * 100))
      : 0;

  const processColumns: TableColumnsType<TopProcessInfo> = [
    {
      title: '名称',
      dataIndex: 'name',
      ellipsis: true,
      render: (_: unknown, row) => (
        <Typography.Text ellipsis={{ tooltip: row.command }} style={{ maxWidth: 180 }}>
          {row.name || '—'}
        </Typography.Text>
      )
    },
    { title: 'PID', dataIndex: 'pid', width: 90, align: 'right' },
    {
      title: 'CPU',
      dataIndex: 'cpuPercent',
      width: 90,
      align: 'right',
      render: (v: number | undefined) => (v == null ? '—' : `${Number(v).toFixed(1)}%`)
    },
    {
      title: '内存',
      dataIndex: 'memMB',
      width: 100,
      align: 'right',
      render: (v: number | undefined) => (v == null ? '—' : `${Number(v).toFixed(1)} MB`)
    }
  ];

  const diskColumns: TableColumnsType<SystemDiskInfo> = [
    { title: '挂载点', dataIndex: 'mount', ellipsis: true, render: (v: string) => v || '—' },
    { title: '设备', dataIndex: 'filesystem', ellipsis: true, render: (v: string) => v || '—' },
    {
      title: '已用 / 总量',
      key: 'size',
      render: (_: unknown, row) => `${bytes(row.used)} / ${bytes(row.total)}`
    },
    { title: '容量', dataIndex: 'percent', width: 80, align: 'right', render: percent },
    { title: 'inode', dataIndex: 'inodePercent', width: 80, align: 'right', render: percent }
  ];

  const portColumns: TableColumnsType<SystemPortInfo> = [
    { title: '端口', dataIndex: 'port', width: 80, align: 'right' },
    { title: '进程', dataIndex: 'process', ellipsis: true, render: (v: string) => v || '未知' },
    { title: '监听地址', dataIndex: 'address', ellipsis: true, render: (v: string) => v || '—' }
  ];

  const openDetail = (key: DetailKey) => setDetail(key);

  const cards: {
    key: DetailKey;
    title: string;
    primary: string;
    secondary: string;
    progress?: number;
  }[] = [
    {
      key: 'memory',
      title: '内存',
      primary: `${bytes(memUsed)} / ${bytes(memTotal)}`,
      secondary: `已用 ${memPct.toFixed(1)}% · 可用 ${bytes(memory.available)}`,
      progress: memPct
    },
    {
      key: 'disk',
      title: '磁盘',
      primary: disks.length
        ? disks
            .slice(0, 3)
            .map((d) => `${d.mount || '—'} ${percent(d.percent)}`)
            .join(' · ')
        : '—',
      secondary: disks.length ? `共 ${disks.length} 个挂载点` : '无真实块设备'
    },
    {
      key: 'ports',
      title: '端口 / 服务',
      primary: `${portTotal} 个监听 · ${failed.length} 个失败单元`,
      secondary: info?.ports?.error
        ? `端口采集失败：${info.ports.error}`
        : info?.systemd?.error
          ? `失败单元采集失败：${info.systemd.error}`
          : '点击查看监听与失败单元明细'
    }
  ];

  return (
    <Card
      title="系统信息"
      size="small"
      style={{ marginBottom: 16 }}
      extra={
        <Typography.Text type="secondary">
          {info ? `主机 ${info.hostname || '—'}` : infoError ? '加载失败' : '加载中…'}
        </Typography.Text>
      }
    >
      {infoError && <Alert type="warning" showIcon message={infoError} style={{ marginBottom: 12 }} />}

      {!info && !infoError ? (
        <div style={{ padding: '24px 0', textAlign: 'center' }}>
          <Spin />
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 4 }}>
            <Typography.Text type="secondary">
              {info?.os || '—'} · 内核 {info?.kernel || '—'} · {info?.arch || '—'}
            </Typography.Text>
          </div>
          <div style={{ marginBottom: 16 }}>
            <Typography.Text type="secondary">
              运行 {fmtDuration(info?.uptimeSeconds)} · 负载 {loadText}
            </Typography.Text>
          </div>

          <Row gutter={[12, 12]}>
            {cards.map((card) => (
              <Col key={card.key} xs={24} sm={8}>
                <Card
                  size="small"
                  hoverable
                  role="button"
                  tabIndex={0}
                  aria-label={`查看${card.title}明细`}
                  onClick={() => openDetail(card.key)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openDetail(card.key);
                    }
                  }}
                  style={{ height: '100%' }}
                >
                  <Typography.Text type="secondary">{card.title}</Typography.Text>
                  <Typography.Title level={5} style={{ margin: '6px 0' }}>
                    {card.primary}
                  </Typography.Title>
                  {card.progress != null && (
                    <Progress percent={Number(card.progress.toFixed(1))} showInfo={false} size="small" />
                  )}
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {card.secondary}
                  </Typography.Text>
                </Card>
              </Col>
            ))}
          </Row>

          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={24} lg={14}>
              <Typography.Title level={5} style={{ margin: '0 0 8px' }}>
                Top 进程
              </Typography.Title>
              {processError && (
                <Typography.Text type="warning" style={{ display: 'block', marginBottom: 8 }}>
                  {processError}
                </Typography.Text>
              )}
              <Table<TopProcessInfo>
                rowKey="pid"
                size="small"
                columns={processColumns}
                dataSource={processes.slice(0, PROCESS_ROWS)}
                pagination={false}
                scroll={{ x: 'max-content' }}
                locale={{ emptyText: '暂无进程数据' }}
              />
            </Col>

            <Col xs={24} lg={10}>
              <Typography.Title level={5} style={{ margin: '0 0 8px' }}>
                失败单元
              </Typography.Title>
              {info?.systemd?.error && (
                <Typography.Text type="warning" style={{ display: 'block', marginBottom: 8 }}>
                  {info.systemd.error}
                </Typography.Text>
              )}
              {failed.length ? (
                <Space size={[4, 8]} wrap>
                  {failed.map((unit) => (
                    <Tag key={unit.name} color="error" title={unit.description}>
                      {unit.name || '—'}
                    </Tag>
                  ))}
                </Space>
              ) : (
                <Typography.Text type="secondary">无失败单元</Typography.Text>
              )}

              <Typography.Title level={5} style={{ margin: '16px 0 8px' }}>
                最近登录
              </Typography.Title>
              {info?.logins?.error && (
                <Typography.Text type="warning" style={{ display: 'block', marginBottom: 8 }}>
                  {info.logins.error}
                </Typography.Text>
              )}
              {logins.length ? (
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  {logins.map((item, i) => (
                    <Typography.Text key={`${item.user || 'user'}-${i}`} style={{ overflowWrap: 'anywhere' }}>
                      {item.user || '—'} · {item.ip || '—'} ·{' '}
                      <Typography.Text type="secondary">{item.time || '—'}</Typography.Text>
                    </Typography.Text>
                  ))}
                </Space>
              ) : (
                <Typography.Text type="secondary">暂无登录记录</Typography.Text>
              )}
            </Col>
          </Row>
        </>
      )}

      <Drawer
        open={detail !== null}
        onClose={() => setDetail(null)}
        width="min(560px, 100vw)"
        title={detail ? DETAIL_TITLES[detail] : ''}
      >
        {detail === 'memory' && (
          <Descriptions column={1} size="small">
            <Descriptions.Item label="已用">{bytes(memUsed)}</Descriptions.Item>
            <Descriptions.Item label="可用">{bytes(memory.available)}</Descriptions.Item>
            <Descriptions.Item label="缓存（可回收）">{bytes(memory.cached)}</Descriptions.Item>
            <Descriptions.Item label="总计">{bytes(memTotal)}</Descriptions.Item>
            <Descriptions.Item label="Swap">{`${bytes(swap.used)} / ${bytes(swap.total)}`}</Descriptions.Item>
            <Descriptions.Item label="CPU 型号">{info?.cpuModel || '—'}</Descriptions.Item>
            <Descriptions.Item label="逻辑核数">
              {info?.cpuCores == null ? '—' : String(info.cpuCores)}
            </Descriptions.Item>
          </Descriptions>
        )}

        {detail === 'disk' && (
          <Table<SystemDiskInfo>
            rowKey={(row) => `${row.mount || ''}-${row.filesystem || ''}`}
            size="small"
            columns={diskColumns}
            dataSource={disks}
            pagination={false}
            scroll={{ x: 'max-content' }}
            locale={{ emptyText: '无真实块设备' }}
          />
        )}

        {detail === 'ports' && (
          <>
            {info?.ports?.error && (
              <Alert type="warning" showIcon message={info.ports.error} style={{ marginBottom: 12 }} />
            )}
            <Table<SystemPortInfo>
              rowKey={(row, i) => `${row.port || 0}-${row.pid || 0}-${i}`}
              size="small"
              columns={portColumns}
              dataSource={ports}
              pagination={false}
              scroll={{ x: 'max-content' }}
              locale={{ emptyText: '无监听端口' }}
            />
            <div style={{ marginTop: 16 }}>
              <Typography.Title level={5} style={{ margin: '0 0 8px' }}>
                失败单元
              </Typography.Title>
              {failed.length ? (
                <Space size={[4, 8]} wrap>
                  {failed.map((unit) => (
                    <Tag key={unit.name} color="error" title={unit.description}>
                      {unit.name || '—'}
                    </Tag>
                  ))}
                </Space>
              ) : (
                <Typography.Text type="secondary">无失败单元</Typography.Text>
              )}
            </div>
            <div style={{ marginTop: 16 }}>
              <Typography.Title level={5} style={{ margin: '0 0 8px' }}>
                最近登录
              </Typography.Title>
              {logins.length ? (
                logins.map((item, i) => (
                  <DetailRow
                    key={`${item.user || 'user'}-${i}`}
                    label={item.user || '—'}
                    value={`${item.ip || '—'} · ${item.time || '—'}`}
                  />
                ))
              ) : (
                <Typography.Text type="secondary">暂无登录记录</Typography.Text>
              )}
            </div>
          </>
        )}
      </Drawer>
    </Card>
  );
}
