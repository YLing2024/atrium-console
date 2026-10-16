/**
 * 数据库 Tab 的「首次激活后保持挂载」语义（纯函数，便于单测守住行为）。
 *
 * 背景：Database 面板在 Main 里常驻挂载、仅切换 `hidden`；若 iframe 跟随 `active`
 * 卸载，用户切走后会丢失 DBGate 里正在浏览的表 / 查询状态。组件因此用一个粘滞标记：
 * 一旦激活过就永久为 true，`active` 转回 false 也不再卸载。
 *
 * @param activated 之前是否已激活过（粘滞标记当前值）
 * @param active 该 Tab 当前是否处于激活态
 * @returns 更新后的粘滞标记；一旦为 true 便保持 true
 */
export function latchActivated(activated: boolean, active: boolean): boolean {
  return activated || active;
}
