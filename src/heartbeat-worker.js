/**
 * 心跳 Worker：Web Worker 内的 setInterval 不受页面可见性节流影响，
 * 页面切出屏幕（后台标签页）后仍按 25s 持续触发。
 *
 * 只负责定时向主线程 postMessage('tick')，WebSocket 连接仍在主线程（ws.js），
 * 由主线程收到 tick 后发送心跳帧并判定连接死活。Worker 被 terminate() 后
 * 内部定时器随之销毁。
 */

const HEARTBEAT_INTERVAL = 25000;

setInterval(() => {
  postMessage('tick');
}, HEARTBEAT_INTERVAL);
