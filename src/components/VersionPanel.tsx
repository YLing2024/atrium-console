import { useEffect, useRef, useState } from 'react';
import { Alert, Table, Typography } from 'antd';
import type { TableProps } from 'antd';
import { getVersions } from '../api';
import type { VersionInfo } from '../api';

// 软件版本面板：进入版本 Tab 时加载一次 getVersions（不做轮询），
// 避免每次切 Tab 都重复执行 alist version 等重命令堆积
export default function VersionPanel({ active }: { active: boolean }) {
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!active || fetchedRef.current) return;
    fetchedRef.current = true;
    let alive = true;
    setLoading(true);
    getVersions()
      .then((v) => {
        if (alive) setVersions(v?.list || []);
      })
      .catch((e) => {
        if (alive) setError((e as Error).message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [active]);

  const columns: TableProps<VersionInfo>['columns'] = [
    { title: '软件', dataIndex: 'name', key: 'name' },
    { title: '类别', dataIndex: 'category', key: 'category' },
    {
      title: '版本',
      dataIndex: 'version',
      key: 'version',
      render: (version: string | undefined, row: VersionInfo) =>
        row.ok === false ? <Typography.Text type="danger">{version}</Typography.Text> : version
    }
  ];

  return (
    <div className="system">
      <div className="system-head">
        <Typography.Title level={4} style={{ margin: 0 }}>
          软件版本
        </Typography.Title>
      </div>

      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}

      <Table<VersionInfo>
        rowKey="name"
        columns={columns}
        dataSource={versions}
        loading={loading}
        pagination={false}
        size="small"
        locale={{ emptyText: error ? ' ' : '加载中…' }}
      />
    </div>
  );
}
