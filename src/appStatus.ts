import type { AppInfo } from './api';

// 状态词（接口 status → 展示文案，白名单内）
export const STATUS_LABEL: Record<string, string> = {
  up: '正常',
  auth: '需登录',
  degraded: '响应慢',
  down: '异常',
  idle: '休眠',
  unknown: '未知'
};

// 接口 status → 白名单内状态；未登记的一律归为 unknown（数据归一化）
export function statusOf(app: AppInfo): string {
  return STATUS_LABEL[app.status] ? app.status : 'unknown';
}
