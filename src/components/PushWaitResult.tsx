import { PUSH_WAIT_MS } from '../notificationPush';
import type { PushState } from '../notificationPush';

/**
 * 发通知后的「推送等待结果」行（通知管理页 / 调试页共用）：
 *   等待 → 已提交到服务器，等待推送…（带指示）
 *   到达 → ✓ 已收到服务器推送（x.xs）
 *   超时 → ✗ 10 秒内未收到推送 —— 实时通道可能断了（附「重新拉取列表」）
 * 结果由父组件状态保留，直到下一次发送才清空。
 */
export default function PushWaitResult({
  state,
  onRepull,
  repulled,
  className = ''
}: {
  state: PushState | null;
  onRepull: () => void;
  repulled: boolean;
  className?: string;
}) {
  if (!state) return null;
  return (
    <div className={'push-result' + (className ? ' ' + className : '')} data-phase={state.phase}>
      {state.phase === 'waiting' && (
        <span className="push-result-line">
          <span className="push-spinner" aria-hidden="true" />
          已提交到服务器，等待推送…
        </span>
      )}
      {state.phase === 'received' && (
        <span className="push-result-line ok">
          ✓ 已收到服务器推送（{((state.elapsedMs || 0) / 1000).toFixed(1)}s）
        </span>
      )}
      {state.phase === 'timeout' && (
        <span className="push-result-line bad">
          ✗ {PUSH_WAIT_MS / 1000} 秒内未收到推送 —— 实时通道可能断了
          <button type="button" className="btn-ghost push-result-repull" onClick={onRepull}>
            重新拉取列表
          </button>
        </span>
      )}
      {state.phase === 'timeout' && repulled && (
        <span className="push-result-note muted">已重新拉取列表</span>
      )}
    </div>
  );
}
