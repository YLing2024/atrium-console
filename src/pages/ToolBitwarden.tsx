/**
 * `/tools/bitwarden` 独立解锁页：把主密码换成服务端 session，供服务器上的 bw CLI 使用。
 *
 * props：无。页面**只能**通过 `/tools/bitwarden` 直接访问或从工具导航页进入，
 * 不依赖先打开 `/tools`，因此刷新、收藏、分享都能落在同一页。
 *
 * 隐私：密码只存在本组件的 React state 里，提交后立刻清空；不写 localStorage /
 * sessionStorage / URL，失败时也不保留输入。服务端 401 表示密码错误而不是会话失效
 * （`src/api.ts` 的 `unauthorizedAsBusinessError` 已单独处理）。
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Alert, App, Button, Input, Skeleton, Space, Typography } from 'antd';
import {
  getBitwardenStatus,
  getTools,
  lockBitwarden,
  unlockBitwarden,
  type BitwardenStatus,
  type ToolItem
} from '../api';
import { bitwardenStatusText, fmtDateTime } from '../format';
import { navigate } from '../router';
import { remainingFromExpiresAt } from '../toolStatus';

export default function ToolBitwarden() {
  const { message } = App.useApp();
  const [tool, setTool] = useState<ToolItem | null>(null);
  const [status, setStatus] = useState<BitwardenStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [password, setPassword] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [locking, setLocking] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await getBitwardenStatus());
      setStatusError('');
    } catch (e) {
      setStatusError((e as Error).message);
    }
  }, []);

  // 直接从地址栏进入时，先拿清单确认是否配置，再读解锁状态（没有 session 也安全）。
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const tools = await getTools();
        if (alive) setTool(tools.find((item) => item.id === 'bitwarden') ?? null);
      } catch (e) {
        if (alive) setLoadError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (tool?.configured) {
      void refreshStatus();
    } else {
      setStatus(null);
    }
  }, [tool?.configured, refreshStatus]);

  const configured = Boolean(tool?.configured);
  const unlocked = status ? status.unlocked : Boolean(tool?.unlocked);
  const remaining = status
    ? status.expiresInSeconds
    : remainingFromExpiresAt(tool?.expiresAt);
  const statusText = bitwardenStatusText(configured, unlocked, remaining);
  const busy = unlocking || locking;

  async function submitUnlock(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!configured || busy || !password) return;
    setUnlocking(true);
    try {
      await unlockBitwarden(password);
      setPassword(''); // 成功也立即清空，密码不在界面多停留一秒
      await refreshStatus();
      message.success('已解锁');
    } catch (e) {
      // 失败不保留输入；401 由 api.ts 统一成「密码错误」。
      setPassword('');
      message.error((e as Error).message || '密码错误');
    } finally {
      setUnlocking(false);
    }
  }

  async function clearSession() {
    if (!configured || busy) return;
    setLocking(true);
    try {
      await lockBitwarden();
      setPassword('');
      await refreshStatus();
      message.success('已清除会话');
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLocking(false);
    }
  }

  return (
    <div className="tool-page">
      <Button type="link" className="tool-back" onClick={() => navigate('/tools')}>
        ‹ 工具
      </Button>

      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Space direction="vertical" size={2}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Bitwarden 解锁
          </Typography.Title>
          <Typography.Text type="secondary">
            把主密码换成 session，供服务器上的 bw CLI 与本机助手使用。主密码不保存。
          </Typography.Text>
        </Space>

        {loadError ? (
          <Alert type="error" showIcon message={loadError} />
        ) : loading ? (
          <Skeleton active paragraph={{ rows: 3 }} />
        ) : (
          <>
            <div className="tool-page-status">
              <Typography.Text strong>状态：</Typography.Text>
              <Typography.Text type={unlocked ? 'success' : 'secondary'}>
                {statusText}
              </Typography.Text>
              {unlocked && status?.updatedAt != null && (
                <Typography.Text type="secondary" className="tool-updated">
                  更新于 {fmtDateTime(status.updatedAt)}
                </Typography.Text>
              )}
            </div>

            {!configured && (
              <Alert type="warning" showIcon message="未配置 BITWARDEN_*" />
            )}
            {statusError && <Alert type="error" showIcon message={statusError} />}

            <form className="tool-page-form" onSubmit={submitUnlock}>
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Input.Password
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="主密码"
                  aria-label="主密码"
                  autoComplete="off"
                  disabled={!configured || busy}
                />
                <Space wrap>
                  <Button
                    type="primary"
                    htmlType="submit"
                    loading={unlocking}
                    disabled={!configured || busy || !password}
                  >
                    解锁
                  </Button>
                  <Button
                    danger
                    loading={locking}
                    disabled={!configured || busy || !unlocked}
                    onClick={clearSession}
                  >
                    清除会话
                  </Button>
                </Space>
              </Space>
            </form>
          </>
        )}
      </Space>
    </div>
  );
}
