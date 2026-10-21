/**
 * 运维动作的客户端封装。
 *
 * 后端要求 `confirm` 必须等于目标名——这里在用户确认后自动带上，
 * 避免用户手输错；真正防误触的是「弹窗 + 二次确认 + 后端拒绝名单」。
 */
import { message } from 'antd';
import { request } from './api';

export type OpKind = 'service' | 'container';
export type OpAction = 'start' | 'stop' | 'restart';

export interface OpResult {
  ok: boolean;
  kind: string;
  name: string;
  action: string;
  output?: string;
  elapsedMs: number;
}

const LABEL: Record<OpAction, string> = { start: '启动', stop: '停止', restart: '重启' };

/** 执行一个动作并给出统一反馈；返回是否成功。 */
export async function runOp(kind: OpKind, name: string, action: OpAction): Promise<boolean> {
  try {
    const res = await request<OpResult>('/api/admin/ops', {
      method: 'POST',
      body: JSON.stringify({ kind, name, action, confirm: name })
    });
    message.success(`${LABEL[action]} ${name} 成功（${res.elapsedMs}ms）`);
    return true;
  } catch (e) {
    message.error((e as Error).message || `${LABEL[action]} 失败`);
    return false;
  }
}
