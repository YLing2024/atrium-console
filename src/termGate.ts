/**
 * 终端口令门模式判定（纯函数，便于单测守住行为）。
 *
 * 背景：后端 `GET /api/admin/term/mode` 返回 `{ unlockRequired: boolean }`。关闭口令门
 * （`ADMIN_TERM_UNLOCK=off`）时 `unlockRequired === false`，前端跳过口令表单直接取票。
 * 探测失败（网络错 / 404 旧后端 / 字段缺失 / 非布尔）一律按「需要口令」兜底，与既有行为
 * 一致：旧后端下不回退到免口令，也不会白屏。
 *
 * @param data 已解析的响应体（不可信输入，任意类型；解析失败传 null 即可）
 * @returns 是否仍需终端口令；仅显式 `false` 才为 false，其余（含缺字段 / 非布尔 / 非对象）一律 true
 */
export function unlockRequiredOf(data: unknown): boolean {
  if (data && typeof data === 'object') {
    return (data as { unlockRequired?: unknown }).unlockRequired !== false;
  }
  return true;
}
