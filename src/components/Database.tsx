import { useEffect, useState } from 'react';
import { latchActivated } from '../dbTab';

/**
 * 数据库面板：用 iframe 同源内嵌 DBGate（部署侧挂在 `/db/`）。
 *
 * 为何用同源相对路径：`/db/` 与终端 Tab 的 `/term/` 属同一套接线——部署侧把该路径
 * 反代到仅监听本机的 DBGate。写死域名或加环境变量都会把部署细节漏进仓库，故这里
 * 只写相对路径（真实域名 / 反代由部署决定），也便于同源复用后台自身。
 *
 * 为何延迟挂载：本面板在 `Main` 里常驻挂载、仅切换显隐；若直接渲染 iframe，每次
 * 打开后台都会拉起 DBGate 前端。因此等 `active` 首次为 true 才渲染 iframe，首次
 * 激活后保持挂载（切走不卸载），以免丢失正在浏览的表 / 查询状态。
 *
 * 鉴权：登录态与未登录跳转均由前置 Auth Gateway 负责，本组件不写任何鉴权逻辑，
 * 也不向 iframe 注入凭据 / token。
 *
 * @param props.active 该 Tab 是否处于激活态（必填，无默认值）；首次为 true 后组件保持挂载
 */
export default function Database({ active }: { active: boolean }) {
  const [mounted, setMounted] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // 粘滞：一旦激活过就保持挂载，active 转回 false 也不卸载 iframe。
  useEffect(() => {
    setMounted((m) => latchActivated(m, active));
  }, [active]);

  function openNewWindow() {
    window.open('/db/', '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="db">
      <div className="db-bar">
        <h2>数据库</h2>
        <span className="db-hint muted">窄屏下建议新窗口打开</span>
        <div className="db-actions">
          <button type="button" className="btn-ghost" onClick={openNewWindow}>
            新窗口打开
          </button>
          <button type="button" className="btn-ghost" onClick={() => setReloadKey((k) => k + 1)}>
            刷新
          </button>
        </div>
      </div>
      <div className="db-frame">
        {mounted && (
          <iframe
            key={reloadKey}
            src="/db/"
            title="数据库"
            referrerPolicy="no-referrer"
            allow="clipboard-read; clipboard-write"
          />
        )}
      </div>
    </div>
  );
}
