import { useEffect, useRef, useState } from 'react';
import { getSystem, getSystemHistory, getServices } from '../api.js';

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

// 进度条（CPU / 内存 / 磁盘共用）。动态变色：>80% 红、60-80% 橙、<60% 绿
function Bar({ percent }) {
  const p = Math.max(0, Math.min(100, percent || 0));
  const tone = p > 80 ? 'hi' : p >= 60 ? 'mid' : 'low';
  return (
    <div className="bar">
      <div className={'bar-fill ' + tone} style={{ width: p + '%' }} />
    </div>
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

// 固定时间窗口（30 个点）+ 平移查看历史。WINDOW 即默认显示最近 30 秒。
const WINDOW = 30;

function clampOffset(o, len) {
  return Math.min(Math.max(0, o), Math.max(0, len - WINDOW));
}

// 纯 SVG 折线图：多序列共用一个 Y 轴。yMax 固定时（百分比）用 0-100 刻度，
// 否则根据数据最大值动态取整。支持滚轮 / 拖拽平移窗口查看历史。
function LineChart({ data, series, yMax, yLabel }) {
  const iw = CHART_W - PAD.l - PAD.r;
  const ih = CHART_H - PAD.t - PAD.b;

  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const wrapRef = useRef(null);
  const dragRef = useRef(null);
  const prevLenRef = useRef(0);

  // 数据更新时自动跟随：offset 在最近位置（跟随模式）则右移显示最新；
  // 已左移查看历史时保持当前位置不跳动
  useEffect(() => {
    if (!data) return;
    const prevLen = prevLenRef.current;
    prevLenRef.current = data.length;
    if (data.length <= prevLen) return;
    setOffset((cur) =>
      cur + WINDOW >= prevLen ? Math.max(0, data.length - WINDOW) : cur
    );
  }, [data]);

  // 鼠标滚轮水平平移（deltaY/deltaX）
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !data || data.length < 2) return;
    const onWheel = (e) => {
      e.preventDefault();
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!Number.isFinite(delta) || Math.abs(delta) < 1) return;
      setOffset((cur) => clampOffset(cur + Math.round(delta / 20), data.length));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [data]);

  if (!data || data.length < 2) {
    return <div className="chart-empty muted">数据采集中…（约 3 秒后显示趋势）</div>;
  }

  const len = data.length;
  const windowData = data.slice(offset, offset + WINDOW);
  const W = windowData.length;
  const pxPerPoint = iw / Math.max(1, W - 1);
  const isFollowing = offset + WINDOW >= len;

  const maxVal = Math.max(
    1,
    ...windowData.flatMap((d) => series.map((s) => Number(d[s.key]) || 0))
  );
  const axisMax = yMax || niceMax(maxVal);

  const x = (i) => PAD.l + (i / Math.max(1, W - 1)) * iw;
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
    dragRef.current = { startX: e.clientX, startOffset: offset };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e) => {
    if (!dragRef.current) return;
    const dx = dragRef.current.startX - e.clientX;
    setOffset(clampOffset(dragRef.current.startOffset + Math.round(dx / pxPerPoint), len));
  };
  const endDrag = (e) => {
    dragRef.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <div
      ref={wrapRef}
      className={'chart-wrap' + (dragging ? ' dragging' : '')}
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
            {fmtTime(windowData[i].ts)}
          </text>
        ))}

        {series.map((s) => (
          <path
            key={s.key}
            d={pathFor(s.key)}
            className="chart-line"
            fill="none"
            style={{ stroke: s.color }}
          />
        ))}
      </svg>

      {!isFollowing && (
        <button className="chart-back-btn" onClick={() => setOffset(Math.max(0, len - WINDOW))}>
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
const CPU_SERIES = [
  { key: 'cpu', label: 'CPU', color: 'var(--accent)' },
  { key: 'mem_percent', label: '内存', color: 'var(--muted)' }
];
const NET_SERIES = [
  { key: 'net_rx_rate', label: '↓ 下载', color: 'var(--accent)', format: fmtRate },
  { key: 'net_tx_rate', label: '↑ 上传', color: 'var(--muted)', format: fmtRate }
];
const IO_SERIES = [
  { key: 'disk_io_read', label: '读', color: 'var(--accent)', format: fmtRate },
  { key: 'disk_io_write', label: '写', color: 'var(--muted)', format: fmtRate }
];

export default function System() {
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [services, setServices] = useState([]);
  const [processes, setProcesses] = useState([]);
  const [totalCpu, setTotalCpu] = useState(null);
  const [procSort, setProcSort] = useState('mem');
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState(null);

  useEffect(() => {
    let timer;
    let alive = true;

    async function load() {
      try {
        const d = await getSystem();
        if (!alive) return;
        setData(d);
        setUpdated(new Date());
        setError('');
      } catch (e) {
        if (alive) setError(e.message);
      }
    }

    load();
    timer = setInterval(load, 1000); // 每 1 秒刷新
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  // 历史采样：每 1 秒拉一次，供趋势图使用
  useEffect(() => {
    let timer;
    let alive = true;

    async function load() {
      try {
        const h = await getSystemHistory();
        if (!alive) return;
        setHistory(Array.isArray(h) ? h : []);
      } catch (e) {
        // 失败时保留已有数据，避免趋势图闪断
      }
    }

    load();
    timer = setInterval(load, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  // 服务状态：每 1 秒拉一次
  useEffect(() => {
    let timer;
    let alive = true;

    async function load() {
      try {
        const s = await getServices();
        if (!alive) return;
        setServices(Array.isArray(s) ? s : s?.services || []);
        setProcesses(s?.processes || []);
        setTotalCpu(s?.total_cpu != null ? s.total_cpu : null);
      } catch (e) {
        // 失败时保留已有数据
      }
    }

    load();
    timer = setInterval(load, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

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
          <Row k="型号" v={cpu.model} />
          <Row k="核心数" v={cpu.cores} />
          <Row k="进程" v={procCount ? `${procCount.running} / ${procCount.total}` : '—'} />
          <Row k="负载 (1/5/15m)" v={loadavg} />
        </Card>

        <Card title="内存">
          <div className="big">{memory.percent == null ? '—' : memory.percent + '%'}</div>
          <Bar percent={memory.percent} />
          <Row k="已用" v={fmtBytes(memory.used)} />
          <Row k="剩余" v={fmtBytes(memory.free)} />
          <Row k="总计" v={fmtBytes(memory.total)} />
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
        {disk && (
          <Card title="磁盘">
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
        )}
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
        <h3 className="block-title">趋势</h3>
        <div className="cards">
          <Card title="CPU / 内存（%）">
            <Legend series={CPU_SERIES} data={history} />
            <LineChart data={history} series={CPU_SERIES} yMax={100} yLabel="%" />
          </Card>
          <Card title="网速（/s）">
            <Legend series={NET_SERIES} data={history} />
            <LineChart data={history} series={NET_SERIES} />
          </Card>
          <Card title="磁盘 I/O（/s）">
            <Legend series={IO_SERIES} data={history} />
            <LineChart data={history} series={IO_SERIES} />
          </Card>
        </div>
      </div>
    </div>
  );
}
