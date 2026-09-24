import { useEffect, useRef, useState } from 'react';
import { getToken, getSystemMetrics } from '../api.js';

function fmtBytes(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Number(n);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return v.toFixed(1) + ' ' + units[i];
}

function fmtMB(mb) {
  if (mb == null || !Number.isFinite(Number(mb))) return '—';
  const v = Number(mb);
  return (Number.isInteger(v) ? v : v.toFixed(1)) + ' MB';
}

function fmtRate(bps) {
  if (bps == null || !isFinite(bps)) return '—';
  return fmtBytes(bps) + '/s';
}

function fmtDuration(s) {
  if (s == null || !Number.isFinite(Number(s))) return '—';
  s = Math.floor(Number(s));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d) parts.push(d + ' 天');
  if (h) parts.push(h + ' 小时');
  if (m) parts.push(m + ' 分钟');
  return parts.join(' ') || '刚刚';
}

function fmtTime(ts) {
  const t = new Date(ts);
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  const ss = String(t.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// 占用率 → 颜色分级：>80% 红、60-80% 橙、<60% 绿（Bar 与每核小条共用）
function toneFor(percent) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  return p > 80 ? 'hi' : p >= 60 ? 'mid' : 'low';
}

// 进度条（CPU / 内存 / 磁盘共用）。动态变色规则见 toneFor
function Bar({ percent }) {
  const p = Math.max(0, Math.min(100, percent || 0));
  return (
    <div className="bar">
      <div className={'bar-fill ' + toneFor(p)} style={{ width: p + '%' }} />
    </div>
  );
}

// 每核占用区块：cpu.per_core 缺失或为空时整块不渲染（兼容旧后端）
function CoreGrid({ cores }) {
  if (!Array.isArray(cores) || cores.length === 0) return null;
  return (
    <div className="cores">
      {cores.map((c, i) => {
        const id = c && c.id != null ? c.id : i;
        const raw = c && c.usage_percent != null ? Number(c.usage_percent) : 0;
        const p = Math.max(0, Math.min(100, Number.isFinite(raw) ? raw : 0));
        return (
          <div className="core" key={id}>
            <div className="core-top">
              <span className="core-id">#{id}</span>
              <span className="core-pct">{p.toFixed(1)}%</span>
            </div>
            <div className="core-bar">
              <div className={'bar-fill ' + toneFor(p)} style={{ width: p + '%' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// 单块磁盘卡片：多盘列表与旧单盘回退共用同一结构
function DiskCard({ title, disk }) {
  return (
    <Card title={title}>
      <div className="disk">
        <div className="disk-top">
          <span>已用 {fmtBytes(disk.used)}</span>
          <span className="muted">
            {disk.percent == null ? '—' : disk.percent + '%'} · 共 {fmtBytes(disk.total)}
          </span>
        </div>
        <Bar percent={disk.percent} />
        <Row k="剩余 / 总" v={`${fmtBytes(disk.free)} / ${fmtBytes(disk.total)}`} />
      </div>
    </Card>
  );
}

function Card({ title, children }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="row">
      <span className="row-k">{k}</span>
      <span className="row-v">{v}</span>
    </div>
  );
}

// 百分比小数的展示：有限数保留一位小数，null/非法显示 —
function fmtPct(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(1) : '—';
}

// PSI 行：k=资源名，o=/proc/pressure 解析结果（{ some:{avg10,..}, full:{..} } 或 null）。
// 显示 some/full 的 avg10；无 PSI 时显示 —。压力越大颜色越警示（some≥50 红、≥30 橙）
function PsiRow({ k, o }) {
  if (!o || !o.some) return <Row k={k} v="—" />;
  const s = Number(o.some.avg10);
  const color = s >= 50 ? 'var(--danger)' : s >= 30 ? 'var(--warn)' : undefined;
  const v = `some ${fmtPct(o.some.avg10)}% · full ${fmtPct(o.full ? o.full.avg10 : null)}%`;
  return (
    <div className="row">
      <span className="row-k">{k}</span>
      <span className="row-v" style={color ? { color } : undefined}>{v}</span>
    </div>
  );
}

// 向上取整到友好刻度（1/2/5×10^n），用于速率类 Y 轴
function niceMax(v) {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return nice * pow;
}

const CHART_W = 640;
const CHART_H = 200;
const PAD = { l: 46, r: 12, t: 12, b: 24 };

// 秒档默认窗口（30 个点，行为保持不变）；分钟/小时/天档默认最近约 60 个点
const WINDOW = 30;
const WINDOW_WIDE = 60;

// 各档位 / 各图表的平移位置记忆（内存即可）：切走再切回时恢复上次位置，不回弹
const chartViewMemory = new Map();

function clampOffset(o, len, win) {
  return Math.min(Math.max(0, o), Math.max(0, len - win));
}

// X 轴时间刻度格式化：分钟 HH:mm、小时 MM-DD HH:00、天 MM-DD、秒 HH:mm:ss（秒档不变）
function formatTick(ts, granularity) {
  const t = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  if (granularity === 'hour') return `${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:00`;
  if (granularity === 'day') return `${p(t.getMonth() + 1)}-${p(t.getDate())}`;
  if (granularity === 'min') return `${p(t.getHours())}:${p(t.getMinutes())}`;
  return fmtTime(ts); // 秒档 HH:mm:ss（沿用原函数，行为不变）
}

// 纯 SVG 折线图：多序列共用一个 Y 轴。yMax 固定时（百分比）用 0-100 刻度，
// 否则根据数据最大值动态取整。
// - 秒档（granularity='sec'）行为保持原样：窗口 30 点、跟随最新、可拖拽/滚轮、回最新按钮。
// - 分钟/小时/天档（sparse=true）：窗口 60 点；0 点占位、1 点也画出（点 + 水平虚线参考线）；
//   拖动平移，到边即停并给反馈，松手不回弹，位置按档位记忆在内存。
function LineChart({ data, series, yMax, yLabel, granularity, chartId, recordedMinutes }) {
  const iw = CHART_W - PAD.l - PAD.r;
  const ih = CHART_H - PAD.t - PAD.b;

  const sparse = granularity !== 'sec';
  const win = sparse ? WINDOW_WIDE : WINDOW;
  const memoryKey = sparse && chartId ? granularity + ':' + chartId : null;

  const remembered = memoryKey ? chartViewMemory.get(memoryKey) : null;
  const [offset, setOffset] = useState(remembered ? remembered.offset : 0);
  const [dragging, setDragging] = useState(false);
  const [edge, setEdge] = useState(null);
  const wrapRef = useRef(null);
  const dragRef = useRef(null);
  const followRef = useRef(remembered ? remembered.follow : true);

  // 记住当前平移位置（仅非秒档；秒档 memoryKey=null，行为不变）
  function remember(nextOffset, following) {
    followRef.current = following;
    if (memoryKey) chartViewMemory.set(memoryKey, { offset: nextOffset, follow: following });
  }

  // 切换档位（memoryKey 变化）：先恢复该档位上次的平移位置（须在下面的数据 effect 之前执行）
  useEffect(() => {
    if (!memoryKey) return;
    const m = chartViewMemory.get(memoryKey);
    followRef.current = m ? m.follow : true;
    setOffset(m ? m.offset : 0);
    setEdge(null);
  }, [memoryKey]);

  // 数据更新时自动跟随：初始及跟随状态下始终对齐最新；
  // 用户手动平移离开最新后保持当前位置不跳动
  useEffect(() => {
    if (!data) return;
    if (followRef.current) {
      const next = Math.max(0, data.length - win);
      setOffset((cur) => (cur !== next ? next : cur));
      if (memoryKey) chartViewMemory.set(memoryKey, { offset: next, follow: true });
    } else {
      // 非跟随：仅在越界时 clamp，避免保留非法 offset，绝不回弹到最新
      setOffset((cur) => {
        const next = clampOffset(cur, data.length, win);
        if (memoryKey) chartViewMemory.set(memoryKey, { offset: next, follow: false });
        return next;
      });
    }
  }, [data, win, memoryKey]);

  // 鼠标滚轮水平平移（deltaY/deltaX）
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !data || data.length < 2) return;
    const onWheel = (e) => {
      e.preventDefault();
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!Number.isFinite(delta) || Math.abs(delta) < 1) return;
      setOffset((cur) => {
        const next = clampOffset(cur + Math.round(delta / 20), data.length, win);
        remember(next, next + win >= data.length);
        return next;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [data, win, memoryKey]);

  // 空数据：非秒档给出「数据积累中」占位（带已记录分钟数），秒档维持原文案
  if (!data || data.length === 0) {
    return sparse ? (
      <div className="chart-empty muted">
        数据积累中（已记录 {recordedMinutes == null ? 0 : recordedMinutes} 分钟）
      </div>
    ) : (
      <div className="chart-empty muted">数据采集中…（约 3 秒后显示趋势）</div>
    );
  }
  // 秒档不足 2 点：行为保持原样（占位）；非秒档单点也要可见
  if (!sparse && data.length < 2) {
    return <div className="chart-empty muted">数据采集中…（约 3 秒后显示趋势）</div>;
  }

  const len = data.length;
  const windowData = data.slice(offset, offset + win);
  const W = windowData.length;
  const single = W === 1;
  const pxPerPoint = iw / Math.max(1, W - 1);
  const isFollowing = offset + win >= len;
  const maxOffset = Math.max(0, len - win);

  const maxVal = Math.max(
    1,
    ...windowData.flatMap((d) => series.map((s) => Number(d[s.key]) || 0))
  );
  const axisMax = yMax || niceMax(maxVal);

  // 单点时落在绘图区水平中央，其它情况按点均匀铺开
  const x = (i) => (single ? PAD.l + iw / 2 : PAD.l + (i / Math.max(1, W - 1)) * iw);
  const y = (v) => PAD.t + (1 - (Number(v) || 0) / axisMax) * ih;
  const pathFor = (key) =>
    windowData
      .map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`)
      .join(' ');

  // Y 轴刻度：百分比固定 0/50/100 三档，速率动态按 axisMax 取 5 档
  const ticks = yMax ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];

  // X 轴时间标签：按窗口内数据动态取首 / 中 / 尾 3-4 个
  const labelIdx = [
    ...new Set([0, Math.floor((W - 1) / 3), Math.floor((2 * (W - 1)) / 3), W - 1])
  ].filter((i) => i >= 0 && i < W);

  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // 点在「回最新」按钮上时不接管指针，保证按钮可正常点击
    if (e.target && e.target.closest && e.target.closest('button')) return;
    if (e.preventDefault) e.preventDefault();
    dragRef.current = { startX: e.clientX, startOffset: offset };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e) => {
    if (!dragRef.current) return;
    if (e.preventDefault) e.preventDefault();
    const dx = dragRef.current.startX - e.clientX;
    const raw = dragRef.current.startOffset + Math.round(dx / pxPerPoint);
    const next = clampOffset(raw, len, win);
    remember(next, next + win >= len);
    // 到边反馈仅非秒档（秒档行为保持不变）
    if (sparse) setEdge(raw < 0 ? 'start' : raw > maxOffset ? 'end' : null);
    setOffset(next);
  };
  const endDrag = (e) => {
    dragRef.current = null;
    setDragging(false);
    setEdge(null);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <div
      ref={wrapRef}
      className={
        'chart-wrap' +
        (dragging ? ' dragging' : '') +
        (edge ? ' edge-' + edge : '')
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <svg className="chart" viewBox={`0 0 ${CHART_W} ${CHART_H}`} role="img">
        {ticks.map((t) => {
          const v = t * axisMax;
          return (
            <g key={t}>
              <line x1={PAD.l} y1={y(v)} x2={CHART_W - PAD.r} y2={y(v)} className="chart-grid" />
              <text x={PAD.l - 6} y={y(v) + 4} className="chart-axis" textAnchor="end">
                {yMax ? Math.round(v) + (yLabel || '') : fmtRate(v)}
              </text>
            </g>
          );
        })}

        {labelIdx.map((i) => (
          <text
            key={windowData[i].ts + '-' + i}
            x={x(i)}
            y={CHART_H - 8}
            className="chart-axis"
            textAnchor="middle"
          >
            {formatTick(windowData[i].ts, granularity)}
          </text>
        ))}

        {single
          ? series.map((s) => (
              <g key={s.key}>
                <line
                  x1={PAD.l}
                  y1={y(windowData[0][s.key])}
                  x2={CHART_W - PAD.r}
                  y2={y(windowData[0][s.key])}
                  className="chart-line chart-line-single"
                  style={{ stroke: s.color }}
                />
                <circle cx={x(0)} cy={y(windowData[0][s.key])} r={3} fill={s.color} />
              </g>
            ))
          : series.map((s) => (
              <path
                key={s.key}
                d={pathFor(s.key)}
                className="chart-line"
                fill="none"
                style={{ stroke: s.color }}
              />
            ))}
      </svg>

      {sparse && edge && <div className={'chart-edge chart-edge-' + edge} aria-hidden="true" />}

      {!isFollowing && (
        <button
          className="chart-back-btn"
          onClick={() => {
            remember(Math.max(0, len - win), true);
            setOffset(Math.max(0, len - win));
          }}
        >
          回最新
        </button>
      )}
    </div>
  );
}

// 图例：色块 + 名称 + 最新值
function Legend({ series, data }) {
  const last = data && data.length ? data[data.length - 1] : null;
  return (
    <div className="chart-legend">
      {series.map((s) => (
        <span key={s.key} className="chart-legend-item">
          <span className="chart-swatch" style={{ background: s.color }} />
          <span>{s.label}</span>
          {last != null && (
            <span className="chart-last">{s.format ? s.format(last[s.key]) : last[s.key]}</span>
          )}
        </span>
      ))}
    </div>
  );
}

// 趋势序列定义：单点缀色（琥珀）+ 中性灰，走 CSS 变量自动适配明暗
const MEM_SERIES = [
  { key: 'cpu', label: 'CPU', color: 'var(--muted)' },
  { key: 'mem_percent', label: '物理内存', color: 'var(--accent)' },
  { key: 'swap_percent', label: 'Swap', color: 'var(--ok)' }
];
const PSI_SERIES = [
  { key: 'psi_mem_avg10', label: '内存', color: 'var(--danger)', format: fmtPct },
  { key: 'psi_cpu_avg10', label: 'CPU', color: 'var(--accent)', format: fmtPct },
  { key: 'psi_io_avg10', label: 'I/O', color: 'var(--muted)', format: fmtPct }
];
const NET_SERIES = [
  { key: 'net_rx_rate', label: '↓ 下载', color: 'var(--accent)', format: fmtRate },
  { key: 'net_tx_rate', label: '↑ 上传', color: 'var(--muted)', format: fmtRate }
];
const IO_SERIES = [
  { key: 'disk_io_read', label: '读', color: 'var(--accent)', format: fmtRate },
  { key: 'disk_io_write', label: '写', color: 'var(--muted)', format: fmtRate }
];

// 趋势粒度：秒 = 现有 SSE 实时流（默认，行为不变）；其它档位改用历史聚合接口。
// 选择存 sessionStorage，刷新后保持；首次访问默认「秒」。
const GRANULARITY_KEY = 'admin_trend_granularity';
const GRANULARITY_OPTIONS = [
  { id: 'sec', label: '秒' },
  { id: 'min', label: '分钟' },
  { id: 'hour', label: '小时' },
  { id: 'day', label: '天' }
];
const GRANULARITY_IDS = GRANULARITY_OPTIONS.map((g) => g.id);
// 非秒档位的 range/step 与刷新频率（与需求表一致）
const GRANULARITY_QUERY = {
  min: { range: '1d', step: '1m', refreshMs: 30000 },
  hour: { range: '7d', step: '1h', refreshMs: 300000 },
  day: { range: '30d', step: '1d', refreshMs: 1800000 }
};

// 读取上次选择：非法值（含旧版本残留）一律回退「秒」
function readGranularity() {
  try {
    const v = sessionStorage.getItem(GRANULARITY_KEY);
    if (GRANULARITY_IDS.includes(v)) return v;
  } catch (e) {
    // sessionStorage 不可用：走默认
  }
  return 'sec';
}

export default function System({ active }) {
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [services, setServices] = useState([]);
  const [processes, setProcesses] = useState([]);
  const [totalCpu, setTotalCpu] = useState(null);
  const [procSort, setProcSort] = useState('mem');
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState(null);
  const [granularity, setGranularity] = useState(readGranularity);
  const [trendPoints, setTrendPoints] = useState([]);
  // 非秒档最近一次成功响应里的 meta（用于「数据积累中（已记录 X 分钟）」占位）
  const [trendRecordedMinutes, setTrendRecordedMinutes] = useState(null);
  const trendCacheRef = useRef({}); // 各档位上次成功的数据，切回时立即命中，避免闪空
  const trendMetaCacheRef = useRef({}); // 各档位上次成功的 meta

  // SSE 实时推送：仅 active（系统 Tab 激活）时建连，切走立即断开，无任何轮询。
  // 不用 EventSource 是因为无法携带 Authorization header，改用 fetch + ReadableStream
  useEffect(() => {
    if (!active) return;

    let disposed = false;
    let retryTimer = null;
    let ctrl = null;

    // 解析单条 SSE 帧（event: / data: 行），data 为 JSON { system, services, history }
    function parseFrame(frame) {
      let event = null;
      let data = null;
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data = line.slice(5).trim();
      }
      if (event !== 'snapshot' || data == null) return;
      let d;
      try {
        d = JSON.parse(data);
      } catch (e) {
        return;
      }
      if (!d || d.system == null) return;
      setData(d.system);
      setHistory(Array.isArray(d.history) ? d.history : []);
      const s = d.services || {};
      setServices(Array.isArray(s) ? s : s.services || []);
      setProcesses(s.processes || []);
      setTotalCpu(s.total_cpu != null ? s.total_cpu : null);
      setUpdated(new Date());
      setError('');
    }

    async function connect() {
      if (disposed) return;
      ctrl = new AbortController();
      try {
        const resp = await fetch('/api/admin/system/stream', {
          headers: { Authorization: 'Bearer ' + getToken() },
          signal: ctrl.signal
        });
        if (!resp.ok || !resp.body) throw new Error('SSE HTTP ' + resp.status);
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (!disposed && !ctrl.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            if (frame) parseFrame(frame);
          }
        }
      } catch (e) {
        if (disposed || ctrl.signal.aborted) return; // 主动断开：静默退出
      }
      if (disposed || ctrl.signal.aborted) return;
      // 连接断开（或流结束）且 Tab 仍激活：提示并 5s 后自动重试
      setError('连接已断开，正在重连…');
      retryTimer = setTimeout(connect, 5000);
    }

    connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      ctrl?.abort(); // 切走 / 卸载立即断开，零残留
    };
  }, [active]);

  // 非「秒」档位：忽略 SSE 数据对趋势图的影响，改从历史聚合接口按刷新频率拉取。
  // 切换档位立即拉一次；失败保持上一帧（不清空），不闪空、不影响页面其它部分。
  useEffect(() => {
    const cfg = GRANULARITY_QUERY[granularity];
    if (!active || !cfg) return;

    let disposed = false;
    let timer = null;

    // 该档位已有缓存：先立即渲染，避免切回时闪空
    const cached = trendCacheRef.current[granularity];
    if (Array.isArray(cached)) setTrendPoints(cached);
    const cachedMeta = trendMetaCacheRef.current[granularity];
    if (cachedMeta && Number.isFinite(Number(cachedMeta.recordedSeconds))) {
      setTrendRecordedMinutes(Math.floor(Number(cachedMeta.recordedSeconds) / 60));
    }

    async function load() {
      try {
        const d = await getSystemMetrics(cfg.range, cfg.step);
        if (disposed) return;
        if (d && Array.isArray(d.points)) {
          trendCacheRef.current[granularity] = d.points;
          setTrendPoints(d.points);
          if (d.meta && Number.isFinite(Number(d.meta.recordedSeconds))) {
            trendMetaCacheRef.current[granularity] = d.meta;
            setTrendRecordedMinutes(Math.floor(Number(d.meta.recordedSeconds) / 60));
          }
        }
      } catch (e) {
        // 请求失败：保留上一帧，等待下次刷新重试
      }
    }

    load();
    timer = setInterval(load, cfg.refreshMs);
    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
    };
  }, [granularity, active]);

  // 切换粒度并记忆到 sessionStorage
  function selectGranularity(id) {
    setGranularity(id);
    try {
      sessionStorage.setItem(GRANULARITY_KEY, id);
    } catch (e) {
      // 存储不可用：仅本次不记忆，不影响切换
    }
  }

  if (!data) {
    return (
      <div className="system">
        <div className="empty">{error || '加载中…'}</div>
      </div>
    );
  }

  const cpu = data.cpu || {};
  const memory = data.memory || {};
  const disk = data.disk || null;
  const network = data.network || null;
  const disk_io = data.disk_io || null;
  const procCount = data.processes || null;
  const { uptime, os, hostname } = data;
  const swap = memory.swapTotal ? memory : null;
  const zram = memory.zram || null;
  const psi = data.psi || {};
  // loadavg 防御：服务端可能给数组（[1,5,15]）或字符串/缺失，非数组不调用 .map 以免整页崩溃
  const loadavg = Array.isArray(cpu.loadavg)
    ? cpu.loadavg.map((v) => Number(v).toFixed(2)).join(' / ')
    : cpu.loadavg != null
      ? String(cpu.loadavg)
      : '—';

  // 进程排行：按名称升序（拼音/字符串），按内存 mem_mb / CPU cpu 降序
  const sortedProcesses = [...processes].sort((a, b) => {
    if (procSort === 'name') {
      return String(a.name).localeCompare(String(b.name), 'zh');
    }
    const av = Number(procSort === 'mem' ? a.mem_mb : a.cpu) || 0;
    const bv = Number(procSort === 'mem' ? b.mem_mb : b.cpu) || 0;
    return bv - av;
  });

  // 趋势数据源：秒档位沿用 SSE 实时 history；其它档位用聚合接口结果
  const trend = granularity === 'sec' ? history : trendPoints;

  return (
    <div className="system">
      <div className="system-head">
        <h2>系统监控</h2>
        <span className="muted">更新于 {updated ? updated.toLocaleTimeString('zh-CN') : '--'}</span>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="cards">
        <Card title="CPU">
          <div className="big">{cpu.usage_percent == null ? '—' : cpu.usage_percent + '%'}</div>
          <Bar percent={cpu.usage_percent} />
          <CoreGrid cores={cpu.per_core} />
          <Row k="型号" v={cpu.model} />
          <Row k="核心数" v={cpu.cores} />
          <Row k="进程" v={procCount ? `${procCount.running} / ${procCount.total}` : '—'} />
          <Row k="负载 (1/5/15m)" v={loadavg} />
        </Card>

        <Card title="内存">
          <div className="big">{memory.percent == null ? '—' : memory.percent + '%'}</div>
          <Bar percent={memory.percent} />
          <Row k="已用（不含缓存）" v={fmtBytes(memory.used)} />
          <Row k="可用" v={memory.available != null ? fmtBytes(memory.available) : '—'} />
          <Row k="其中缓存（可回收）" v={memory.buffCache != null ? fmtBytes(memory.buffCache) : '—'} />
          <Row k="剩余 / 总计" v={`${fmtBytes(memory.free)} / ${fmtBytes(memory.total)}`} />
        </Card>

        <Card title="Swap">
          {swap ? (
            <>
              <div className="big">{memory.swapPercent + '%'}</div>
              <Bar percent={memory.swapPercent} />
              <Row k="已用" v={fmtBytes(memory.swapUsed)} />
              <Row k="剩余 / 总计" v={`${fmtBytes(memory.swapFree)} / ${fmtBytes(memory.swapTotal)}`} />
              {zram ? (
                <Row k="zram (lz4)" v={`${fmtBytes(zram.used)} / ${fmtBytes(zram.total)}`} />
              ) : (
                <Row k="zram" v="无" />
              )}
            </>
          ) : (
            <>
              <div className="big muted">0%</div>
              <Bar percent={0} />
              <Row k="zram" v="无" />
              <Row k="备注" v="本机未配置 swap" />
            </>
          )}
        </Card>

        <Card title="PSI 压力">
          <PsiRow k="内存 (memory)" o={psi.memory} />
          <PsiRow k="CPU" o={psi.cpu} />
          <PsiRow k="I/O" o={psi.io} />
          <Row k="说明" v="avg10 压力 · some/full" />
        </Card>

        <Card title="系统">
          <Row k="主机名" v={hostname} />
          <Row k="操作系统" v={os} />
          <Row k="运行时长" v={fmtDuration(uptime)} />
        </Card>

        <Card title="网络">
          <Row k="↓ 下载" v={network ? fmtRate(network.rx_rate) : '—'} />
          <Row k="↑ 上传" v={network ? fmtRate(network.tx_rate) : '—'} />
          <Row k="累计下载" v={network ? fmtBytes(network.rx_bytes) : '—'} />
          <Row k="累计上传" v={network ? fmtBytes(network.tx_bytes) : '—'} />
        </Card>

        <Card title="磁盘 I/O">
          <Row k="读" v={disk_io ? fmtRate(disk_io.read_rate) : '—'} />
          <Row k="写" v={disk_io ? fmtRate(disk_io.write_rate) : '—'} />
          <Row k="累计读" v={disk_io ? fmtBytes(disk_io.read_bytes) : '—'} />
          <Row k="累计写" v={disk_io ? fmtBytes(disk_io.write_bytes) : '—'} />
        </Card>
      </div>

      <div className="cards">
        {Array.isArray(data.disks) && data.disks.length > 0
          ? data.disks.map((d, i) => (
              <DiskCard
                key={(d && d.mount ? d.mount : 'disk') + '-' + i}
                title={'磁盘 ' + (d && d.mount ? d.mount : '')}
                disk={d || {}}
              />
            ))
          : disk && <DiskCard title="磁盘" disk={disk} />}
      </div>

      {processes.length > 0 && (
        <div className="services-block">
          <div className="proc-head">
            <h3 className="block-title">进程排行</h3>
            <div className="proc-sort">
              <button
                type="button"
                className={'proc-sort-btn' + (procSort === 'name' ? ' active' : '')}
                onClick={() => setProcSort('name')}
              >
                按名称
              </button>
              <button
                type="button"
                className={'proc-sort-btn' + (procSort === 'mem' ? ' active' : '')}
                onClick={() => setProcSort('mem')}
              >
                按内存
              </button>
              <button
                type="button"
                className={'proc-sort-btn' + (procSort === 'cpu' ? ' active' : '')}
                onClick={() => setProcSort('cpu')}
              >
                按 CPU
              </button>
            </div>
          </div>
          <div className="process-list">
            <div className="list-head">
              <span className="dot-spacer" />
              <span className="process-name">进程</span>
              <span className="process-pid">PID</span>
              <span className="process-mem">内存</span>
              <span className="process-cpu">CPU</span>
            </div>
            {sortedProcesses.map((p) => (
              <div className="process-row" key={p.pid}>
                <span className={`service-dot ${services.find((s) => s.pid === p.pid)?.status === 'down' ? 'down' : 'up'}`} />
                <span className="process-name">{p.name}</span>
                <span className="process-pid">{p.pid}</span>
                <span className="process-mem">{fmtMB(p.mem_mb)}</span>
                <span className="process-cpu">{(Number(p.cpu) || 0).toFixed(1)}%</span>
              </div>
            ))}
            <div className="process-total">
              <span className="process-name">合计（全部进程）</span>
              <span className="process-pid" />
              <span className="process-mem" />
              <span className="process-cpu">
                {totalCpu == null ? '—' : Number(totalCpu).toFixed(1) + '%'}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="trend-block">
        <div className="trend-head">
          <h3 className="block-title">趋势</h3>
          <div className="granularity" role="group" aria-label="趋势粒度">
            {GRANULARITY_OPTIONS.map((g) => (
              <button
                key={g.id}
                type="button"
                className={'gran-btn' + (granularity === g.id ? ' active' : '')}
                aria-pressed={granularity === g.id}
                onClick={() => selectGranularity(g.id)}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
        <div className="cards cards-charts">
          <Card title="CPU / 内存 / Swap（%）">
            <Legend series={MEM_SERIES} data={trend} />
            <LineChart
              data={trend}
              series={MEM_SERIES}
              yMax={100}
              yLabel="%"
              granularity={granularity}
              chartId="mem"
              recordedMinutes={trendRecordedMinutes}
            />
          </Card>
          <Card title="PSI 压力 · some avg10（%）">
            <Legend series={PSI_SERIES} data={trend} />
            <LineChart
              data={trend}
              series={PSI_SERIES}
              yMax={100}
              yLabel="%"
              granularity={granularity}
              chartId="psi"
              recordedMinutes={trendRecordedMinutes}
            />
          </Card>
          <Card title="网速（/s）">
            <Legend series={NET_SERIES} data={trend} />
            <LineChart
              data={trend}
              series={NET_SERIES}
              granularity={granularity}
              chartId="net"
              recordedMinutes={trendRecordedMinutes}
            />
          </Card>
          <Card title="磁盘 I/O（/s）">
            <Legend series={IO_SERIES} data={trend} />
            <LineChart
              data={trend}
              series={IO_SERIES}
              granularity={granularity}
              chartId="io"
              recordedMinutes={trendRecordedMinutes}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
