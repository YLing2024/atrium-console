import { Empty } from 'antd';

/**
 * 调试页：工具容器（左侧工具列表 + 右侧工具面板）。
 *
 * 原先唯一的调试工具是「通知调试」，已随通知中心功能整体下线（2026-10-19）；
 * 当前没有可用的调试工具，展示空态，不造占位工具。
 */
export default function Debug() {
  return (
    <div className="debug">
      <div className="debug-head">
        <h2>调试</h2>
      </div>
      <div className="debug-body">
        <div className="debug-panel">
          <Empty description="暂无调试工具" />
        </div>
      </div>
    </div>
  );
}
