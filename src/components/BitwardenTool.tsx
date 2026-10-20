/**
 * Bitwarden 解锁卡片：把主密码换成服务端会话 token，供服务器上的 bw CLI 与 Hermes 使用。
 *
 * props：
 * - `tool`（必填）：`GET /api/admin/tools` 的单项，提供配置/解锁状态与过期时间；
 * - `onChanged`（必填）：解锁或清除成功后通知父级重新拉取工具清单（无参数，返回 Promise）。
 *
 * 事件：提交表单调 `unlockBitwarden`，按钮调 `lockBitwarden`；成功后刷新本卡状态并提示剩余有效期。
 *
 * 隐私：密码只存在本组件的 React state 里，提交后立刻清空；不写 localStorage / sessionStorage /
 * URL，也不在失败时保留输入。服务端 401 表示密码错误，不是会话失效（`src/api.ts` 已单独处理）。
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Alert, App, Button, Card, Input, Space, Tag, Typography } from 'antd';
import { LockOutlined, UnlockOutlined } from '@ant-design/icons';
import {
  getBitwardenStatus,
  lockBitwarden,
  unlockBitwarden,
  type BitwardenStatus,
  type ToolItem
} from '../api';
import { bitwardenStatusText, fmtDateTime, fmtDuration } from '../format';
import { remainingFromExpiresAt } from '../toolStatus';

export interface ToolCardProps {
  tool: ToolItem;
  onChanged: () => Promise<void>;
}

export default function BitwardenTool({ tool, onChanged }: ToolCardProps) {
  const { message } = App.useApp();
  const [status, setStatus] = useState<BitwardenStatus | null>(null);
  const [password, setPassword] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [locking, setLocking] = useState(false);
  const [statusError, setStatusError] = useState('');

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await getBitwardenStatus());
      setStatusError('');
    } catch (e) {
      setStatusError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!tool.configured) {
      setStatus(null);
      return;
    }
    void refreshStatus();
  }, [tool.configured, refreshStatus]);

  const unlocked = status ? status.unlocked : tool.unlocked;
  const remaining = status
    ? status.expiresInSeconds
    : remainingFromExpiresAt(tool.expiresAt);
  const statusText = bitwardenStatusText(tool.configured, unlocked, remaining);
  const busy = unlocking || locking;

  async function submitUnlock(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!tool.configured || busy || !password) return;
    setUnlocking(true);
    try {
      const result = await unlockBitwarden(password);
      setPassword(''); // 成功也立即清空，密码不在界面多停留一秒
      if (result.expiresInSeconds == null) {
        message.success('已解锁（有效期未知）');
      } else {
        message.success(`已解锁，剩余有效期 ${fmtDuration(result.expiresInSeconds)}`);
      }
      await onChanged();
      await refreshStatus();
    } catch (e) {
      // 失败不保留输入；文案由服务端统一给出「密码错误」。
      setPassword('');
      message.error((e as Error).message || '密码错误');
    } finally {
      setUnlocking(false);
    }
  }

  async function clearSession() {
    if (!tool.configured || busy) return;
    setLocking(true);
    try {
      await lockBitwarden();
      setPassword('');
      message.success('已清除会话');
      await onChanged();
      await refreshStatus();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLocking(false);
    }
  }

  const extra = (
    <Tag color={!tool.configured ? 'default' : unlocked ? 'success' : 'default'}>
      {!tool.configured ? '未配置' : unlocked ? '已解锁' : '已锁定'}
    </Tag>
  );

  return (
    <Card
      className={'tool-card' + (!tool.configured ? ' tool-card--disabled' : '')}
      title={
        <Space size={8}>
          {unlocked ? <UnlockOutlined /> : <LockOutlined />}
          <span>{tool.name}</span>
        </Space>
      }
      extra={extra}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <div>
          <Typography.Text strong>状态：</Typography.Text>
          <Typography.Text type={unlocked ? 'success' : 'secondary'}>{statusText}</Typography.Text>
          {unlocked && status?.updatedAt != null && (
            <Typography.Text type="secondary" className="tool-updated">
              更新于 {fmtDateTime(status.updatedAt)}
            </Typography.Text>
          )}
        </div>

        <Typography.Text type="secondary">
          用途：把主密码换成 session，供服务器上的 bw CLI 与本机助手使用。主密码不保存。
        </Typography.Text>

        {!tool.configured && (
          <Alert
            type="warning"
            showIcon
            message="未配置 BITWARDEN_*，见运维文档"
          />
        )}
        {statusError && <Alert type="error" showIcon message={statusError} />}

        <form onSubmit={submitUnlock}>
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Input.Password
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="主密码"
              aria-label="主密码"
              autoComplete="off"
              disabled={!tool.configured || busy}
            />
            <Space wrap>
              <Button
                type="primary"
                htmlType="submit"
                loading={unlocking}
                disabled={!tool.configured || busy || !password}
              >
                解锁
              </Button>
              <Button danger loading={locking} disabled={!tool.configured || busy || !unlocked} onClick={clearSession}>
                清除会话
              </Button>
            </Space>
          </Space>
        </form>
      </Space>
    </Card>
  );
}
