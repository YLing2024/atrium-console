import type { AppInfo } from '../api';
import { STATUS_LABEL, statusOf } from '../appStatus';
import AppIcon from './AppIcon';

// 单张卡片：有 url 才可点、新窗口打开；url 一律用接口返回值，前端不拼域名。
// 后台「应用」Tab 与公开「应用中心」共用，样式类名与渲染结构保持不变。
export default function AppCard({ app }: { app: AppInfo }) {
  const status = statusOf(app);
  const label = STATUS_LABEL[status];
  const hasPort = app.port != null && app.port !== '';
  const hasLatency = app.latencyMs != null && Number.isFinite(Number(app.latencyMs));

  const body = (
    <>
      <AppIcon name={app.icon} fallback={app.name} />
      <span className="apps-name">{app.name}</span>
      {app.desc ? <span className="apps-desc">{app.desc}</span> : null}
      <span className="apps-meta">
        <span className={'apps-dot apps-dot--' + status} role="img" aria-label={label} />
        <span className="apps-status">{label}</span>
        {hasPort && (
          <>
            <span className="apps-sep" aria-hidden="true">
              ·
            </span>
            <span className="apps-num">{app.port}</span>
          </>
        )}
        {hasLatency && (
          <>
            <span className="apps-sep" aria-hidden="true">
              ·
            </span>
            <span className="apps-num">{Math.round(Number(app.latencyMs))} ms</span>
          </>
        )}
      </span>
    </>
  );

  if (app.url) {
    return (
      <a
        className="apps-card"
        href={app.url}
        target="_blank"
        rel="noopener noreferrer"
        tabIndex={0}
      >
        {body}
      </a>
    );
  }
  return (
    <div className="apps-card apps-card--static" tabIndex={0}>
      {body}
    </div>
  );
}
