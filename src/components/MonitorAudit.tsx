/**
 * MonitorAudit —— 监控页「审计」：失败单元与最近登录两块。
 *
 * 数据来自 `GET /api/admin/system/info`（父级 60s 刷新）。端口已独立成全量表，
 * 这里不再重复。降级规则：失败单元为 0 时不显示红色；最近登录采集失败用灰色说明。
 */
import { Card, Tag, Typography } from 'antd';
import type { SystemInfoResponse, SystemLoginInfo } from '../api';

export interface MonitorAuditProps {
  /** `/api/admin/system/info` 响应；未返回时各块显示破折号 */
  info: SystemInfoResponse | null;
  /** 整个概况接口失败时的提示；各区块仍按自身 error 降级 */
  error?: string;
}

/** 采集失败时的统一灰色说明，不带告警色。 */
function Degraded({ text }: { text: string }) {
  return (
    <Typography.Text type="secondary" className="monitor-audit-note">
      {text}
    </Typography.Text>
  );
}

/** 登录行：用户 · IP · 时间。 */
function LoginRow({ item }: { item: SystemLoginInfo }) {
  return (
    <div className="monitor-audit-row">
      <Typography.Text className="monitor-audit-main">{item.user || '—'}</Typography.Text>
      <Typography.Text type="secondary" ellipsis={{ tooltip: item.ip }} className="monitor-audit-mid">
        {item.ip || '—'}
      </Typography.Text>
      <Typography.Text type="secondary" className="monitor-audit-side monitor-num">
        {item.time || '—'}
      </Typography.Text>
    </div>
  );
}

/**
 * 审计卡片组。
 * @param props 见 {@link MonitorAuditProps}
 */
export default function MonitorAudit({ info, error }: MonitorAuditProps) {
  const failed = Array.isArray(info?.systemd?.failed) ? info.systemd.failed : [];
  const logins = Array.isArray(info?.logins?.items) ? info.logins.items : [];
  const failedError = Boolean(info?.systemd?.error || (!info && error));
  const loginError = Boolean(info?.logins?.error || (!info && error));

  return (
    <div className="monitor-audit">
      <Card
        className="monitor-card monitor-audit-card"
        title="失败单元"
        extra={
          <Typography.Text type="secondary" className="monitor-num">
            {info ? failed.length : '—'}
          </Typography.Text>
        }
      >
        {failedError ? (
          <Degraded text="失败单元采集失败" />
        ) : !info ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : failed.length ? (
          <div className="monitor-tags">
            {failed.map((unit, i) => (
              <Tag key={`${unit.name || 'unit'}-${i}`} color="error" title={unit.description}>
                {unit.name || '—'}
              </Tag>
            ))}
          </div>
        ) : (
          <div className="monitor-audit-zero">
            <span className="monitor-audit-count monitor-num">0</span>
            <Typography.Text type="secondary">无失败单元</Typography.Text>
          </div>
        )}
      </Card>

      <Card
        className="monitor-card monitor-audit-card"
        title="最近登录"
        extra={
          <Typography.Text type="secondary" className="monitor-num">
            {info ? logins.length : '—'}
          </Typography.Text>
        }
      >
        {loginError ? (
          <Degraded text="最近登录采集失败" />
        ) : !info ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : logins.length ? (
          <div className="monitor-audit-list">
            {logins.slice(0, 5).map((item, i) => (
              <LoginRow key={`${item.user || 'user'}-${i}`} item={item} />
            ))}
          </div>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        )}
      </Card>
    </div>
  );
}
