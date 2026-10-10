// 离线状态页：仅在 fetch 因网络不可达（区别于 HTTP 4xx/5xx）时渲染。
// 文案克制，样式复用设计系统的既有类（见 components.css 的 .offline-*）与 .btn-primary。
export default function OfflineNotice() {
  return (
    <div className="offline-wrap">
      <div className="offline-card">
        <span className="offline-mark" aria-hidden="true" />
        <h1 className="offline-title">当前离线</h1>
        <p className="offline-text">网络恢复后刷新即可继续。</p>
        <button className="btn-primary" type="button" onClick={() => window.location.reload()}>
          刷新
        </button>
      </div>
    </div>
  );
}
