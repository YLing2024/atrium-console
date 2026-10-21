/**
 * MonitorPressure —— 监控页右侧「压力与负载」：PSI 三条 avg60 压力条 + 1/5/15 分钟负载
 * + 运行队列 / 阻塞进程 + CPU 温度（有热区时展示）。
 *
 * PSI 值来自系统 SSE 的 `psi`，温度来自 `/api/admin/system/info`。宽度按 0–100 映射，
 * 颜色按需求书阈值（<20 主色、20–50 warning、>50 error）。数值常驻条右侧，颜色不是唯一语义。
 */
import { Card, Tooltip, Typography, theme } from 'antd';
import type { PsiInfo, SystemData, SystemTemperature } from '../api';
import { pressureTone } from '../monitor';
import { fmtDuration, fmtPct } from '../format';

export interface MonitorPressureProps {
  /** 系统 SSE 快照的 system 段；缺失时各条显示破折号 */
  data?: SystemData | null;
  /** `/api/admin/system/info` 的热区读数；无热区时省略温度行 */
  temperatures?: SystemTemperature[];
}

interface PressureRow {
  key: 'cpu' | 'io' | 'memory';
  label: string;
  psi?: PsiInfo;
}

/** avg60 的安全读取：缺失或非法返回 null，而不是 0。 */
function avg60(psi?: PsiInfo): number | null {
  const raw = psi?.some?.avg60;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * 压力与负载卡片。
 * @param props 见 {@link MonitorPressureProps}
 */
export default function MonitorPressure({ data, temperatures }: MonitorPressureProps) {
  const { token } = theme.useToken();
  const rows: PressureRow[] = [
    { key: 'cpu', label: 'CPU', psi: data?.psi?.cpu },
    { key: 'io', label: 'I/O', psi: data?.psi?.io },
    { key: 'memory', label: '内存', psi: data?.psi?.memory }
  ];
  const load = data?.cpu?.loadavg;
  const loads = Array.isArray(load) ? load.slice(0, 3) : [];
  const loadLabels = ['1m', '5m', '15m'];
  const uptime = data?.system?.uptime_sec ?? data?.uptime;
  const zombie = data?.processes?.zombie;
  const handles = data?.system?.file_handles;
  const handlesPercent =
    handles?.percent == null || !Number.isFinite(Number(handles.percent))
      ? null
      : Number(handles.percent);

  return (
    <Card className="monitor-card" title="压力与负载" style={{ height: '100%' }}>
      <Typography.Text type="secondary" className="monitor-card-note">
        some avg60
      </Typography.Text>

      <div className="monitor-psi">
        {rows.map((row) => {
          const value = avg60(row.psi);
          const tone = pressureTone(value);
          const color =
            tone === 'error'
              ? token.colorError
              : tone === 'warning'
                ? token.colorWarning
                : token.colorPrimary;
          const width = value == null ? 0 : Math.max(0, Math.min(100, value));
          return (
            <div className="monitor-psi-row" key={row.key}>
              <div className="monitor-psi-head">
                <Typography.Text>{row.label}</Typography.Text>
                <Typography.Text className="monitor-num">
                  {value == null ? '—' : value.toFixed(2)}
                </Typography.Text>
              </div>
              <div
                className="monitor-psi-track"
                role="progressbar"
                aria-label={`${row.label} PSI some avg60`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={value == null ? undefined : Math.round(width * 100) / 100}
                aria-valuetext={value == null ? '—' : `${value.toFixed(2)}%`}
              >
                <div className="monitor-psi-fill" style={{ width: `${width}%`, background: color }} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="monitor-load">
        <Typography.Text type="secondary" className="monitor-card-note">
          负载
        </Typography.Text>
        <div className="monitor-load-grid">
          {loadLabels.map((label, i) => (
            <div className="monitor-load-cell" key={label}>
              <Typography.Text type="secondary" className="monitor-load-label">
                {label}
              </Typography.Text>
              <Typography.Text className="monitor-load-value monitor-num">
                {loads[i] == null || !Number.isFinite(Number(loads[i]))
                  ? '—'
                  : Number(loads[i]).toFixed(2)}
              </Typography.Text>
            </div>
          ))}
        </div>
        <Typography.Text type="secondary" className="monitor-load-note">
          运行队列 {data?.cpu?.run_queue == null ? '—' : data.cpu.run_queue} /{' '}
          {data?.cpu?.cores == null ? '—' : data.cpu.cores} · 阻塞{' '}
          {data?.cpu?.blocked == null ? '—' : data.cpu.blocked} · 15s 平均{' '}
          {data?.cpu?.usage_15s == null ? '—' : fmtPct(data.cpu.usage_15s) + '%'}
        </Typography.Text>
      </div>

      <div className="monitor-vitals" aria-label="运行状态">
        <div className="monitor-vital">
          <Tooltip title="本次开机至今的时长">
            <Typography.Text type="secondary" className="monitor-vital-label">
              运行时长
            </Typography.Text>
          </Tooltip>
          <Typography.Text className="monitor-vital-value monitor-num">
            {fmtDuration(uptime)}
          </Typography.Text>
        </div>
        <div className="monitor-vital">
          <Tooltip title="状态为 Z 的进程数，需父进程回收">
            <Typography.Text type="secondary" className="monitor-vital-label">
              僵尸进程
            </Typography.Text>
          </Tooltip>
          <Typography.Text className="monitor-vital-value monitor-num">
            {zombie == null || !Number.isFinite(Number(zombie)) ? '—' : Number(zombie)}
          </Typography.Text>
        </div>
        <div className="monitor-vital">
          <Tooltip
            title={
              handles == null
                ? '文件句柄采集不可用'
                : `已用 ${Number(handles.used ?? 0).toLocaleString('zh-CN')} / 上限 ${Number(handles.max ?? 0).toLocaleString('zh-CN')}`
            }
          >
            <Typography.Text type="secondary" className="monitor-vital-label">
              句柄使用率
            </Typography.Text>
          </Tooltip>
          <Typography.Text className="monitor-vital-value monitor-num">
            {/* file-max 常是 2^63 量级，百分比会永远显示 0.0%，此时改显已用绝对值 */}
            {handlesPercent == null
              ? '—'
              : handlesPercent < 0.1 && handles?.used
                ? Number(handles.used).toLocaleString('zh-CN')
                : handlesPercent.toFixed(1) + '%'}
          </Typography.Text>
        </div>
      </div>

      {temperatures && temperatures.length > 0 && (
        <div className="monitor-load monitor-temperature">
          <Typography.Text type="secondary" className="monitor-card-note">
            CPU 温度
          </Typography.Text>
          <div className="monitor-temperature-list">
            {temperatures.map((item, index) => (
              <span className="monitor-temperature-item" key={`${item.zone || 'zone'}-${index}`}>
                <Typography.Text type="secondary" ellipsis={{ tooltip: item.type || item.zone }}>
                  {item.type || item.zone || '—'}
                </Typography.Text>
                <Typography.Text className="monitor-num">
                  {item.celsius == null || !Number.isFinite(Number(item.celsius))
                    ? '—'
                    : Number(item.celsius).toFixed(1) + ' °C'}
                </Typography.Text>
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
