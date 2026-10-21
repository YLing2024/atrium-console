/**
 * 「工具」导航页：只列入口，不放任何表单。
 *
 * props：
 * - `active`（必填）：该 Tab 是否激活；由 `false → true` 时重新拉取
 *   `GET /api/admin/tools`，保证从工具子页返回后看到最新状态。
 *
 * 点击整行用 `navigate('/tools/<id>')` 跳到独立工具页（页面里有解锁表单）。
 * 本组件刻意不渲染 `input`：密码只在 `src/pages/ToolBitwarden.tsx` 出现。
 */
import { useCallback, useEffect, useState } from 'react';
import { Alert, Empty, List, Skeleton, Space, Tag, Typography } from 'antd';
import { getTools, type ToolItem } from '../api';
import { navigate } from '../router';
import { fmtDuration } from '../format';
import { remainingFromExpiresAt } from '../toolStatus';

/** 工具 id → 列表里的一句话说明；未登记的工具不展示，避免跳到不存在的子页。 */
const TOOL_ENTRIES: Record<string, string> = {
  bitwarden: '把主密码换成 session，供服务器上的 bw CLI 使用',
  inbox: '收发一次性内容（文本/文件），读完即焚'
};

/** 外链工具直接开新窗口；其余走独立子页。 */
function openTool(tool: ToolItem) {
  if (tool.url) {
    window.open(tool.url, '_blank', 'noopener,noreferrer');
    return;
  }
  navigate(`/tools/${tool.id}`);
}

/** 列表右侧状态：未配置 / 已锁定为灰，已解锁为绿并附剩余时间。 */
function ToolStatus({ tool }: { tool: ToolItem }) {
  if (tool.url) return <Tag color="processing">新窗口打开</Tag>;
  if (!tool.configured) return <Tag>未配置</Tag>;
  if (!tool.unlocked) return <Tag>已锁定</Tag>;

  const remaining = remainingFromExpiresAt(tool.expiresAt);
  return (
    <Space size={6} wrap>
      <Tag color="success">已解锁</Tag>
      {remaining != null && (
        <Typography.Text type="secondary" className="tool-nav-remaining">
          剩 {fmtDuration(remaining)}
        </Typography.Text>
      )}
    </Space>
  );
}

export default function Tools({ active }: { active: boolean }) {
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setTools(await getTools());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // 进入导航页才取数；面板常驻挂载，但隐藏时不必发请求。
  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  const entries = tools.filter((tool) => TOOL_ENTRIES[tool.id]);

  return (
    <div className="tools">
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Space direction="vertical" size={2}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            工具
          </Typography.Title>
          <Typography.Text type="secondary">
            独立小工具，数据和凭据都由服务端处理。
          </Typography.Text>
        </Space>

        {error && <Alert type="error" showIcon message={error} />}

        {loading && tools.length === 0 ? (
          <Skeleton active paragraph={{ rows: 3 }} />
        ) : entries.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可用工具" />
        ) : (
          <List
            className="tool-nav"
            bordered
            dataSource={entries}
            renderItem={(tool) => (
              <List.Item
                key={tool.id}
                className="tool-nav-item"
                role="button"
                tabIndex={0}
                onClick={() => openTool(tool)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openTool(tool);
                  }
                }}
              >
                <div className="tool-nav-body">
                  <div className="tool-nav-text">
                    <Typography.Text strong>{tool.name}</Typography.Text>
                    <Typography.Text type="secondary" className="tool-nav-desc">
                      {TOOL_ENTRIES[tool.id]}
                    </Typography.Text>
                  </div>
                  <ToolStatus tool={tool} />
                  <span className="tool-nav-chevron" aria-hidden="true">
                    ›
                  </span>
                </div>
              </List.Item>
            )}
          />
        )}
      </Space>
    </div>
  );
}
