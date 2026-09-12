import { useEffect, useState } from 'react';
import { getToken } from '../api.js';

/**
 * 服务器终端：iframe 内嵌 nginx 反代的 ttyd（/term/）。
 *
 * - 认证：nginx 的 /term/ 走本域 SSO 探针（auth_request → 认证中心 /api/verify）；
 *   iframe 无法自定义请求头，故把 token 放进 query（nginx 探针已支持 ?token=）。
 * - 懒挂载：首次切到该 Tab 才建立连接；之后切走不卸载，避免误断会话。
 * - 「重连」：重建 iframe（tmux 会话若已销毁则开新的）。
 */
export default function Terminal({ active }) {
  const [mounted, setMounted] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (active) setMounted(true);
  }, [active]);

  if (!mounted) return null;

  const src = '/term/?token=' + encodeURIComponent(getToken() || '');

  return (
    <div className="term">
      <div className="term-bar">
        <button className="term-btn" type="button" onClick={() => setNonce((n) => n + 1)}>
          重连
        </button>
      </div>
      <iframe key={nonce} className="term-frame" title="服务器终端" src={src} />
    </div>
  );
}
