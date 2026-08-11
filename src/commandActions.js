/**
 * 命令动作注册表：跨组件传递「命令面板」可执行的命令。
 * 例如 Chat 注册 新建会话 / 复制当前会话ID，Main 的命令面板通过 getAction 调用。
 */
const actions = {};

export function registerAction(name, fn) {
  actions[name] = fn;
  return () => {
    delete actions[name];
  };
}

export function getAction(name) {
  return actions[name];
}
