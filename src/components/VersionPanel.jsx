import { useEffect, useRef, useState } from 'react';
import { getVersions } from '../api.js';

// 软件版本面板：进入版本 Tab 时加载一次 getVersions（不做轮询），
// 避免每次切 Tab 都重复执行 alist version 等重命令堆积
export default function VersionPanel({ active }) {
  const [versions, setVersions] = useState([]);
  const [error, setError] = useState('');
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!active || fetchedRef.current) return;
    fetchedRef.current = true;
    let alive = true;
    getVersions()
      .then((v) => {
        if (alive) setVersions(v?.list || []);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [active]);

  return (
    <div className="system">
      <div className="system-head">
        <h2>软件版本</h2>
        <span className="muted">进入本页时加载一次</span>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="services-block">
        {versions.length === 0 ? (
          <div className="empty">{error ? '' : '加载中…'}</div>
        ) : (
          <div className="version-list">
            <div className="list-head version-list-head">
              <span className="version-name">软件</span>
              <span className="version-cat">类别</span>
              <span className="version-val">版本</span>
            </div>
            {versions.map((v) => (
              <div className="version-row" key={v.name}>
                <span className="version-name">{v.name}</span>
                <span className="version-cat muted">{v.category}</span>
                <span className={`version-val ${v.ok ? '' : 'version-bad'}`}>{v.version}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
