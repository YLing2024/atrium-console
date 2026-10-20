/**
 * 「工具」Tab：按 `GET /api/admin/tools` 的清单渲染独立小工具卡片。
 *
 * props：无（面板由 `Main` 常驻挂载）。数据驱动 —— 新工具只需实现一个卡片组件并登记到
 * `TOOL_CARDS`，无需改动侧栏或本页面结构。
 *
 * 注意：清单里的工具各自负责自己的状态与操作；本组件只做拉取、错误提示和响应式排布。
 */
import { useCallback, useEffect, useState, type ComponentType } from 'react';
import { Alert, Col, Empty, Row, Skeleton, Space, Typography } from 'antd';
import { getTools, type ToolItem } from '../api';
import BitwardenTool, { type ToolCardProps } from './BitwardenTool';

const TOOL_CARDS: Record<string, ComponentType<ToolCardProps>> = {
  bitwarden: BitwardenTool
};

export default function Tools() {
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    void load();
  }, [load]);

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
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : tools.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可用工具" />
        ) : (
          <Row gutter={[16, 16]}>
            {tools.map((tool) => {
              const ToolCard = TOOL_CARDS[tool.id];
              if (!ToolCard) return null;
              return (
                <Col key={tool.id} xs={24} lg={12} xl={8}>
                  <ToolCard tool={tool} onChanged={load} />
                </Col>
              );
            })}
          </Row>
        )}
      </Space>
    </div>
  );
}
