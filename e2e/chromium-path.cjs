/* 统一使用机器上唯一的一份 Chromium（Hermes 自带 chromium-1208）。
 * 可用 CHROMIUM_PATH 覆盖；没有该文件时回退到 Playwright 自带浏览器。 */
const fs = require('fs');
const CANDIDATES = [
  process.env.CHROMIUM_PATH,
  '/root/.hermes/tools/chromium-1208/chrome-linux64/chrome',
];
const executablePath = CANDIDATES.find((p) => p && fs.existsSync(p));
module.exports = executablePath;
