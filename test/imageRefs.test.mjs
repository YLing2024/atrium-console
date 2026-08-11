import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImageRefs, normalizeImageRefPath } from '../src/imageRefs.js';

test('单引用：普通绝对路径', () => {
  const { text, images } = parseImageRefs('看图\n@image:/data/uploads/a.png\n另外');
  assert.deepEqual(images, ['/data/uploads/a.png']);
  assert.equal(text, '看图\n\n另外');
});

test('单引用：行内结尾', () => {
  const { text, images } = parseImageRefs('这是图片 @image:/root/pic.jpg');
  assert.deepEqual(images, ['/root/pic.jpg']);
  assert.equal(text, '这是图片 ');
});

test('多引用：多个路径', () => {
  const { text, images } = parseImageRefs(
    'a @image:/tmp/1.png b @image:/tmp/2.jpg c'
  );
  assert.deepEqual(images, ['/tmp/1.png', '/tmp/2.jpg']);
  assert.equal(text, 'a  b  c');
});

test('多引用：去重', () => {
  const { text, images } = parseImageRefs(
    '@image:/tmp/1.png\n@image:/tmp/1.png\n@image:/tmp/2.png'
  );
  assert.deepEqual(images, ['/tmp/1.png', '/tmp/2.png']);
  assert.equal(text, '\n\n');
});

test('无引用文本：原样返回', () => {
  const { text, images } = parseImageRefs('普通消息 @mention @image: 没路径');
  assert.equal(text, '普通消息 @mention @image: 没路径');
  assert.deepEqual(images, []);
});

test('无引用文本：空串', () => {
  const { text, images } = parseImageRefs('');
  assert.equal(text, '');
  assert.deepEqual(images, []);
});

test('引号包裹：反引号（整标签包裹）', () => {
  const { text, images } = parseImageRefs('引用图片 `@image:/data/a.png` 后面');
  assert.deepEqual(images, ['/data/a.png']);
  assert.equal(text, '引用图片  后面');
});

test('引号包裹：路径反引号', () => {
  const { text, images } = parseImageRefs('引用图片 @image:`/data/a.png` 后面');
  assert.deepEqual(images, ['/data/a.png']);
  assert.equal(text, '引用图片  后面');
});

test('引号包裹：双引号', () => {
  const { text, images } = parseImageRefs('@image:"/data/a b.png" 文');
  assert.deepEqual(images, ['/data/a b.png']);
  assert.equal(text, ' 文');
});

test('引号包裹：单引号', () => {
  const { text, images } = parseImageRefs("图 @image:'/x/y.png' 尾");
  assert.deepEqual(images, ['/x/y.png']);
  assert.equal(text, '图  尾');
});

test('路径到标点停止：不全吞后续文本', () => {
  const { text, images } = parseImageRefs('见 @image:/a/b.png，再看 @image:/c/d.jpg。');
  assert.deepEqual(images, ['/a/b.png', '/c/d.jpg']);
  assert.equal(text, '见 ，再看 。');
});

test('assistant 消息带引用同样解析', () => {
  const { text, images } = parseImageRefs('回复附上截图 @image:/root/out.png');
  assert.deepEqual(images, ['/root/out.png']);
  assert.equal(text, '回复附上截图 ');
});

test('normalizeImageRefPath：剥引号与首尾标点', () => {
  assert.equal(normalizeImageRefPath('/a/b.png'), '/a/b.png');
  assert.equal(normalizeImageRefPath('`/a/b.png`'), '/a/b.png');
  assert.equal(normalizeImageRefPath('"/a/b.png"'), '/a/b.png');
  assert.equal(normalizeImageRefPath("'/a/b.png'"), '/a/b.png');
});
