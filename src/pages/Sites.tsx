/**
 * Sites —— 「站点」页（/sites）：nginx server 块、Let's Encrypt 证书、备份目录三张只读卡片。
 *
 * 数据来自 `GET /api/admin/sites/{nginx,certs,backups}`，后端缓存 60 秒。
 * `active` 为 false 时不发请求（面板在 Main 里常驻挂载）；首次激活加载一次，刷新按钮强制重取。
 * 三张表统一小号、无分页、纵向滚动 360px；窄屏由表格容器横滑，页面本身不横向溢出。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Input, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { request } from '../api';
import { fmtBytes, fmtDateTime, fmtRelativeTime } from '../format';

interface SiteRow {
  serverName: string;
  listen: string[];
  root: string | null;
  proxyPass: string | null;
  certPath: string | null;
  configFile: string;
  redirect: string | null;
  isRegex: boolean;
}

interface NginxResult {
  sites: SiteRow[];
  error?: string;
}

interface CertRow {
  domain: string;
  notAfter: string | null;
  daysLeft: number | null;
  issuer: string;
  autoRenew: boolean;
  error?: string;
}

interface CertsResult {
  certs: CertRow[];
  error?: string;
}

interface BackupRow {
  name: string;
  size: number;
  modifiedAt: number;
}

interface BackupTimer {
  name: string;
  nextElapseUSecRealtime: string;
  lastTriggerUSec: string;
}

interface BackupsResult {
  backups: BackupRow[];
  timers: BackupTimer[];
  total: number;
  totalSize: number;
  latestModifiedAt: number;
  error?: string;
}

/** 证书剩余天数 → Tag 颜色：>21 绿、7–21 橙、<7 红；未知不上色。 */
function certTone(days: number | null): string {
  if (days == null) return 'default';
  if (days > 21) return 'green';
  if (days >= 7) return 'orange';
  return 'red';
}

function dateText(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? '—' : fmtDateTime(ms);
}

/** 从 `.../live/<域名>/fullchain.pem` 取域名，用于把站点的证书路径映射到证书列表。 */
function domainFromCertPath(path: string | null): string {
  if (!path) return '';
  const parts = path.split('/').filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : '';
}

function errorLine(message?: string) {
  if (!message) return null;
  return (
    <Typography.Text type="danger" className="sites-error">
      {message}
    </Typography.Text>
  );
}

export default function Sites({ active = true }: { active?: boolean }) {
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [certs, setCerts] = useState<CertRow[]>([]);
  const [backups, setBackups] = useState<BackupsResult>({
    backups: [],
    timers: [],
    total: 0,
    totalSize: 0,
    latestModifiedAt: 0
  });
  const [siteError, setSiteError] = useState('');
  const [certError, setCertError] = useState('');
  const [backupError, setBackupError] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nginx, certResult, backupResult] = await Promise.all([
        request<NginxResult>('/api/admin/sites/nginx'),
        request<CertsResult>('/api/admin/sites/certs'),
        request<BackupsResult>('/api/admin/sites/backups')
      ]);
      setSites(nginx.sites ?? []);
      setSiteError(nginx.error ?? '');
      setCerts(certResult.certs ?? []);
      setCertError(certResult.error ?? '');
      setBackups({
        backups: backupResult.backups ?? [],
        timers: backupResult.timers ?? [],
        total: backupResult.total ?? 0,
        totalSize: backupResult.totalSize ?? 0,
        latestModifiedAt: backupResult.latestModifiedAt ?? 0
      });
      setBackupError(backupResult.error ?? '');
    } catch (e) {
      const message = (e as Error).message;
      setSiteError(message);
      setCertError(message);
      setBackupError(message);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (active && !loaded) void load();
  }, [active, loaded, load]);

  const certByDomain = useMemo(() => {
    const map = new Map<string, CertRow>();
    for (const cert of certs) map.set(cert.domain, cert);
    return map;
  }, [certs]);

  const shownSites = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? sites.filter((site) => site.serverName.toLowerCase().includes(q)) : sites;
    return filtered.map((site, index) => ({
      ...site,
      rowKey: `${site.configFile}:${site.serverName}:${site.listen.join('|')}:${index}`
    }));
  }, [sites, query]);

  const siteColumns: TableColumnsType<SiteRow & { rowKey: string }> = [
    {
      title: '域名',
      dataIndex: 'serverName',
      key: 'serverName',
      width: 220,
      ellipsis: true,
      render: (v: string, row) => (
        <Space size={6}>
          <Typography.Text ellipsis={{ tooltip: v || '未设置 server_name' }}>{v || '—'}</Typography.Text>
          {row.isRegex ? <Tag>正则</Tag> : null}
        </Space>
      )
    },
    {
      title: '监听',
      dataIndex: 'listen',
      key: 'listen',
      width: 170,
      render: (v: string[]) => (v.length ? v.join(' · ') : '—')
    },
    {
      title: '上游 / 根目录',
      key: 'target',
      width: 240,
      ellipsis: true,
      render: (_, row) => {
        const target = row.proxyPass || row.root || '—';
        return (
          <Typography.Text ellipsis={{ tooltip: target }} className="monitor-num">
            {target}
          </Typography.Text>
        );
      }
    },
    {
      title: '证书到期',
      key: 'cert',
      width: 170,
      render: (_, row) => {
        const cert = certByDomain.get(domainFromCertPath(row.certPath));
        if (!cert || cert.notAfter == null) return '—';
        return (
          <Space size={6}>
            <span className="monitor-num">{dateText(cert.notAfter)}</span>
            <Tag color={certTone(cert.daysLeft)}>
              {cert.daysLeft == null ? '—' : `${cert.daysLeft} 天`}
            </Tag>
          </Space>
        );
      }
    },
    {
      title: '配置文件',
      dataIndex: 'configFile',
      key: 'configFile',
      width: 260,
      ellipsis: true,
      render: (v: string) => (
        <Typography.Text code ellipsis={{ tooltip: v }}>
          {v || '—'}
        </Typography.Text>
      )
    }
  ];

  const certColumns: TableColumnsType<CertRow> = [
    {
      title: '域名',
      dataIndex: 'domain',
      key: 'domain',
      width: 240,
      ellipsis: true,
      render: (v: string, row) =>
        row.error ? (
          <Tooltip title={row.error}>
            <Typography.Text type="danger" ellipsis>
              {v}
            </Typography.Text>
          </Tooltip>
        ) : (
          <Typography.Text ellipsis={{ tooltip: v }}>{v}</Typography.Text>
        )
    },
    {
      title: '到期日',
      dataIndex: 'notAfter',
      key: 'notAfter',
      width: 170,
      render: (v: string | null) => <span className="monitor-num">{dateText(v)}</span>
    },
    {
      title: '剩余天数',
      dataIndex: 'daysLeft',
      key: 'daysLeft',
      width: 110,
      render: (v: number | null) =>
        v == null ? '—' : <Tag color={certTone(v)}>{v} 天</Tag>
    },
    {
      title: '签发者',
      dataIndex: 'issuer',
      key: 'issuer',
      width: 170,
      ellipsis: true,
      render: (v: string) => v || '—'
    },
    {
      title: '自动续期',
      dataIndex: 'autoRenew',
      key: 'autoRenew',
      width: 100,
      render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '是' : '否'}</Tag>
    }
  ];

  const backupColumns: TableColumnsType<BackupRow> = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      width: 240,
      ellipsis: true,
      render: (v: string) => (
        <Typography.Text ellipsis={{ tooltip: v }} className="monitor-num">
          {v}
        </Typography.Text>
      )
    },
    {
      title: '大小',
      dataIndex: 'size',
      key: 'size',
      width: 120,
      render: (v: number) => <span className="monitor-num">{fmtBytes(v)}</span>
    },
    {
      title: '时间',
      dataIndex: 'modifiedAt',
      key: 'modifiedAt',
      width: 180,
      render: (v: number) => <span className="monitor-num">{fmtDateTime(v)}</span>
    }
  ];

  const summary = `共 ${backups.total} 份，占用 ${(backups.totalSize / 1024 ** 3).toFixed(2)} GB，最近一次 ${
    backups.latestModifiedAt ? fmtRelativeTime(backups.latestModifiedAt) : '—'
  }`;

  return (
    <div className="sites-page">
      <div className="system-head sites-head">
        <div>
          <h2>站点</h2>
          <Typography.Text type="secondary">只读</Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
          刷新
        </Button>
      </div>

      <Card
        className="monitor-card sites-card"
        title="站点"
        extra={<Typography.Text type="secondary">{sites.length} 个 server</Typography.Text>}
      >
        <Input.Search
          allowClear
          placeholder="搜索域名"
          aria-label="搜索站点域名"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="sites-search"
        />
        {errorLine(siteError)}
        <Table<SiteRow & { rowKey: string }>
          rowKey="rowKey"
          size="small"
          columns={siteColumns}
          dataSource={shownSites}
          loading={loading}
          pagination={false}
          scroll={{ y: 360 }}
          locale={{ emptyText: '—' }}
        />
      </Card>

      <Card
        className="monitor-card sites-card"
        title="证书"
        extra={<Typography.Text type="secondary">{certs.length} 张</Typography.Text>}
      >
        {errorLine(certError)}
        <Table<CertRow>
          rowKey={(row) => row.domain}
          size="small"
          columns={certColumns}
          dataSource={certs}
          loading={loading}
          pagination={false}
          scroll={{ y: 360 }}
          locale={{ emptyText: '—' }}
        />
      </Card>

      <Card className="monitor-card sites-card" title="备份">
        <Typography.Text type="secondary" className="sites-summary">
          {summary}
        </Typography.Text>
        {errorLine(backupError)}
        <Table<BackupRow>
          rowKey={(row) => row.name}
          size="small"
          columns={backupColumns}
          dataSource={backups.backups}
          loading={loading}
          pagination={false}
          scroll={{ y: 360 }}
          locale={{ emptyText: '—' }}
        />
      </Card>
    </div>
  );
}
