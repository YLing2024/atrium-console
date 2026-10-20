import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, routePath } from '../src/router.ts';

test('parseRoute：根路径与未知路径返回 null（交由调用方重定向）', () => {
  assert.equal(parseRoute('/'), null);
  assert.equal(parseRoute('/nope'), null);
  assert.equal(parseRoute('/tools/nope'), null);
  assert.equal(parseRoute('/system/extra'), null);
});

test('parseRoute：各 Tab 路径映射到既有 section id', () => {
  assert.deepEqual(parseRoute('/system'), { section: 'system' });
  assert.deepEqual(parseRoute('/blog'), { section: 'blog' });
  assert.deepEqual(parseRoute('/manage'), { section: 'manage' });
  assert.deepEqual(parseRoute('/ssh'), { section: 'sshkeys' });
  assert.deepEqual(parseRoute('/terminal'), { section: 'terminal' });
  assert.deepEqual(parseRoute('/hermes'), { section: 'hermes' });
  assert.deepEqual(parseRoute('/database'), { section: 'db' });
  assert.deepEqual(parseRoute('/tools'), { section: 'tools' });
});

test('parseRoute：/tools/bitwarden 解析为工具子页', () => {
  assert.deepEqual(parseRoute('/tools/bitwarden'), { section: 'tools', tool: 'bitwarden' });
  assert.deepEqual(parseRoute('/tools/bitwarden/'), { section: 'tools', tool: 'bitwarden' });
});

test('parseRoute：历史别名 /sshkeys 与 /db 仍可解析', () => {
  assert.deepEqual(parseRoute('/sshkeys'), { section: 'sshkeys' });
  assert.deepEqual(parseRoute('/db'), { section: 'db' });
});

test('routePath：section 走规范路径，未知 section 回落系统页', () => {
  assert.equal(routePath('sshkeys'), '/ssh');
  assert.equal(routePath('db'), '/database');
  assert.equal(routePath('tools'), '/tools');
  assert.equal(routePath('tools', 'bitwarden'), '/tools/bitwarden');
  assert.equal(routePath('tools', 'nope'), '/tools');
  assert.equal(routePath('unknown'), '/system');
});
