/**
 * MonitorSystemInfo —— 监控页「系统信息」只读概况。
 *
 * 数据来自 `/api/admin/system/info`（60s 缓存）。只展示静态 / 低频字段；实时 CPU、内存、
 * PSI 等已在 KPI 带与压力卡中呈现，这里不重复堆指标。
 */
import { Card, Descriptions, Typography } from 'antd';
import type { DescriptionsProps } from 'antd';
import type { SystemInfoResponse } from '../api';
import { fmtBytes, fmtDateTime, fmtDuration } from '../format';

export interface MonitorSystemInfoProps {
  info: SystemInfoResponse | null;
  loading?: boolean;
}

/** 缺值统一破折号；0 在容量 / 时间字段里是有效值，不做真假判断。 */
function orDash(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—';
  return String(value);
}

/**
 * 系统信息卡片。
 * @param props 见 {@link MonitorSystemInfoProps}
 */
export default function MonitorSystemInfo({ info, loading }: MonitorSystemInfoProps) {
  const items: DescriptionsProps['items'] = [
    { key: 'os', label: '系统', children: orDash(info?.os) },
    { key: 'kernel', label: '内核', children: orDash(info?.kernel) },
    { key: 'arch', label: '架构', children: orDash(info?.arch) },
    { key: 'host', label: '主机名', children: orDash(info?.hostname) },
    { key: 'boot', label: '启动时间', children: info?.bootTime ? fmtDateTime(info.bootTime) : '—' },
    { key: 'uptime', label: '已运行', children: info?.uptimeSeconds == null ? '—' : fmtDuration(info.uptimeSeconds) },
    { key: 'cpu', label: '处理器', children: orDash(info?.cpuModel) },
    { key: 'cores', label: '逻辑核', children: info?.cpuCores == null ? '—' : String(info.cpuCores) },
    {
      key: 'load',
      label: '负载 1/5/15',
      children: Array.isArray(info?.load) && info.load.length
        ? info.load.map((v) => Number(v).toFixed(2)).join(' / ')
        : '—'
    },
    {
      key: 'mem',
      label: '内存已用 / 总量',
      children:
        info?.memory?.used == null || info.memory.total == null
          ? '—'
          : `${fmtBytes(info.memory.used)} / ${fmtBytes(info.memory.total)}`
    },
    {
      key: 'swap',
      label: 'Swap 已用 / 总量',
      children:
        info?.swap?.total == null
          ? '—'
          : `${fmtBytes(info.swap.used ?? 0)} / ${fmtBytes(info.swap.total)}`
    }
  ];

  return (
    <Card className="monitor-card monitor-system-info" title="系统信息" loading={loading}>
      {info ? (
        <Descriptions size="small" column={{ xs: 1, sm: 1, md: 2, lg: 3 }} items={items} />
      ) : (
        <Typography.Text type="secondary">—</Typography.Text>
      )}
    </Card>
  );
}
