import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFileRefs, normalizeFileRefPath } from '../src/fileRefs.js';

test('单引用：普通绝对路径', () => {
  const { text, files } = parseFileRefs('请读这个文件\n@file:/data/uploads/report.pdf\n谢谢');
  assert.deepEqual(files, [{ path: '/data/uploads/report.pdf', ext: 'pdf' }]);
  assert.equal(text, '请读这个文件\n\n谢谢');
});

test('单引用：行内结尾', () => {
  const { text, files } = parseFileRefs('请查看 @file:/root/notes.txt');
  assert.deepEqual(files, [{ path: '/root/notes.txt', ext: 'txt' }]);
  assert.equal(text, '请查看 ');
});

test('多引用：多个路径换行分隔', () => {
  const { text, files } = parseFileRefs(
    '看这几个文件\n@file:/tmp/a.pdf\n@file:/tmp/b.zip\n谢谢'
  );
  assert.deepEqual(files, [
    { path: '/tmp/a.pdf', ext: 'pdf' },
    { path: '/tmp/b.zip', ext: 'zip' }
  ]);
  assert.equal(text, '看这几个文件\n\n\n谢谢');
});

test('多引用：去重', () => {
  const { text, files } = parseFileRefs(
    '@file:/tmp/1.pdf\n@file:/tmp/1.pdf\n@file:/tmp/2.pdf'
  );
  assert.deepEqual(files, [
    { path: '/tmp/1.pdf', ext: 'pdf' },
    { path: '/tmp/2.pdf', ext: 'pdf' }
  ]);
  assert.equal(text, '\n\n');
});

test('无扩展名路径：ext 为空走通用图标', () => {
  const { files } = parseFileRefs('@file:/root/Makefile');
  assert.deepEqual(files, [{ path: '/root/Makefile', ext: '' }]);
});

test('无引用文本：原样返回', () => {
  const { text, files } = parseFileRefs('普通消息 @file: 没路径 @mention');
  assert.equal(text, '普通消息 @file: 没路径 @mention');
  assert.deepEqual(files, []);
});

test('无引用文本：空串', () => {
  const { text, files } = parseFileRefs('');
  assert.equal(text, '');
  assert.deepEqual(files, []);
});

test('引号包裹：反引号（整标签包裹）', () => {
  const { text, files } = parseFileRefs('引用 `@file:/data/a.pdf` 后面');
  assert.deepEqual(files, [{ path: '/data/a.pdf', ext: 'pdf' }]);
  assert.equal(text, '引用  后面');
});

test('引号包裹：路径反引号', () => {
  const { text, files } = parseFileRefs('引用 @file:`/data/a.pdf` 后面');
  assert.deepEqual(files, [{ path: '/data/a.pdf', ext: 'pdf' }]);
  assert.equal(text, '引用  后面');
});

test('引号包裹：双引号（含空格路径）', () => {
  const { text, files } = parseFileRefs('@file:"/data/my report.pdf" 文');
  assert.deepEqual(files, [{ path: '/data/my report.pdf', ext: 'pdf' }]);
  assert.equal(text, ' 文');
});

test('引号包裹：单引号', () => {
  const { text, files } = parseFileRefs("档 @file:'/x/y.pdf' 尾");
  assert.deepEqual(files, [{ path: '/x/y.pdf', ext: 'pdf' }]);
  assert.equal(text, '档  尾');
});

test('路径到标点停止：不全吞后续文本', () => {
  const { text, files } = parseFileRefs('见 @file:/a/b.pdf，再看 @file:/c/d.json。');
  assert.deepEqual(files, [
    { path: '/a/b.pdf', ext: 'pdf' },
    { path: '/c/d.json', ext: 'json' }
  ]);
  assert.equal(text, '见 ，再看 。');
});

test('assistant 消息带引用同样解析', () => {
  const { text, files } = parseFileRefs('结果存于 @file:/root/out.csv');
  assert.deepEqual(files, [{ path: '/root/out.csv', ext: 'csv' }]);
  assert.equal(text, '结果存于 ');
});

test('fenced 代码块内的 @file: 示例不解析', () => {
  const input = '用法：\n```\n@file:/etc/example.txt\n```\n完毕';
  const { text, files } = parseFileRefs(input);
  assert.deepEqual(files, []);
  assert.equal(text, input);
});

test('行内代码内的 @file: 示例不解析', () => {
  const input = '执行 `cat @file:/etc/hosts` 查看';
  const { text, files } = parseFileRefs(input);
  assert.deepEqual(files, []);
  assert.equal(text, input);
});

test('代码块内引用不解析，块外引用正常解析', () => {
  const { text, files } = parseFileRefs(
    '看这个\n```\n@file:/demo/x.txt\n```\n以及 @file:/real/file.txt'
  );
  assert.deepEqual(files, [{ path: '/real/file.txt', ext: 'txt' }]);
  assert.equal(text, '看这个\n```\n@file:/demo/x.txt\n```\n以及 ');
});

test('normalizeFileRefPath：剥引号与首尾标点', () => {
  assert.equal(normalizeFileRefPath('/a/b.pdf'), '/a/b.pdf');
  assert.equal(normalizeFileRefPath('`/a/b.pdf`'), '/a/b.pdf');
  assert.equal(normalizeFileRefPath('"/a/b.pdf"'), '/a/b.pdf');
  assert.equal(normalizeFileRefPath("'/a/b.pdf'"), '/a/b.pdf');
  assert.equal(normalizeFileRefPath('/a/b.pdf),'), '/a/b.pdf');
});
