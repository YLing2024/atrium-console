import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downloadUrl, fileDownloadUrl } from '../src/api.ts';

test('downloadUrl：路径按 encodeURIComponent 编码', () => {
  assert.equal(
    downloadUrl('/data/uploads/report.pdf'),
    '/api/admin/download?path=%2Fdata%2Fuploads%2Freport.pdf'
  );
  assert.equal(
    downloadUrl('/a b/c&d.pdf'),
    '/api/admin/download?path=' + encodeURIComponent('/a b/c&d.pdf')
  );
});

test('fileDownloadUrl：文件区下载地址前缀正确', () => {
  assert.equal(
    fileDownloadUrl('/x/y.zip'),
    '/api/admin/files/download?path=%2Fx%2Fy.zip'
  );
  assert.equal(fileDownloadUrl(''), '/api/admin/files/download?path=');
});
