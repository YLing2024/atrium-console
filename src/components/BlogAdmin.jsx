import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import {
  getBlogAdminPosts,
  createBlogPost,
  updateBlogPost,
  deleteBlogPost,
  uploadBlogImage,
  getBlogAdminCollections,
  createBlogCollection,
  updateBlogCollection,
  deleteBlogCollection
} from '../api.js';

const EMPTY_FORM = {
  title: '',
  slug: '',
  tags: '',
  excerpt: '',
  content: '',
  published: false,
  collection_id: ''
};
const EMPTY_COLLECTION_FORM = { name: '', slug: '', description: '' };

export default function BlogAdmin() {
  const [posts, setPosts] = useState([]);
  const contentRef = useRef(null); // 正文 textarea（插图光标插入用）
  const imgInputRef = useRef(null); // 插图文件选择
  const [draftNotice, setDraftNotice] = useState(''); // 草稿恢复提示
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // editing === null 列表视图；'new' 新建；数字 = 编辑对应文章 id
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  // 列表视图：'posts' 文章 / 'collections' 合集
  const [view, setView] = useState('posts');
  // 正文编辑/预览切换
  const [previewMode, setPreviewMode] = useState(false);
  // 合集管理：列表 / 表单（'new' 或合集 id）
  const [collections, setCollections] = useState([]);
  const [editingCollection, setEditingCollection] = useState(null);
  const [collectionForm, setCollectionForm] = useState(EMPTY_COLLECTION_FORM);
  const [savingCollection, setSavingCollection] = useState(false);
  const [collectionError, setCollectionError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getBlogAdminPosts();
      setPosts(data.list || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCollections = useCallback(async () => {
    try {
      const data = await getBlogAdminCollections();
      setCollections(data.list || []);
    } catch (e) {
      // 合集加载失败不阻塞文章管理，编辑器下拉为空即可
    }
  }, []);

  useEffect(() => {
    load();
    loadCollections();
  }, [load, loadCollections]);

  // 预览 HTML：marked 渲染 + DOMPurify 消毒（与博客详情一致，Swiss 排版由 CSS 控制）
  const previewHtml = useMemo(
    () => DOMPurify.sanitize(marked.parse(form.content || '')),
    [form.content]
  );

  function startNew() {
    setForm(EMPTY_FORM);
    setSaveError('');
    setEditing('new');
  }

  function startEdit(post) {
    setForm({
      title: post.title,
      slug: post.slug,
      tags: (post.tags || []).join(', '),
      excerpt: post.excerpt || '',
      content: post.content || '',
      published: !!post.published,
      collection_id: post.collection ? post.collection.id : ''
    });
    setSaveError('');
    setEditing(post.id);
    setPreviewMode(false);
  }

  function cancelEdit() {
    setEditing(null);
    setSaveError('');
    setPreviewMode(false);
  }

  function setField(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // 选择图片上传 → 在正文光标处插入 ![](url)
  async function onPickImage(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { url } = await uploadBlogImage(file);
      const ta = contentRef.current;
      const markdown = `![](https://zhangyunling.cn${url})`;
      if (ta) {
        const start = ta.selectionStart ?? form.content.length;
        const end = ta.selectionEnd ?? form.content.length;
        const next = form.content.slice(0, start) + markdown + form.content.slice(end);
        setField('content', next);
        requestAnimationFrame(() => {
          ta.focus();
          const pos = start + markdown.length;
          ta.setSelectionRange(pos, pos);
        });
      } else {
        setField('content', form.content + '\n' + markdown);
      }
      setDraftNotice('图片已插入');
      setTimeout(() => setDraftNotice(''), 2500);
    } catch (err) {
      setSaveError('图片上传失败: ' + err.message);
    }
  }

  // 进入编辑器时恢复一次草稿（仅 editing 变化触发，不随输入反复覆盖）
  useEffect(() => {
    if (editing === null) return;
    const key = 'blog_draft_' + (editing === 'new' ? 'new' : editing);
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        setForm(JSON.parse(saved));
        setDraftNotice('已恢复未保存的草稿');
        setTimeout(() => setDraftNotice(''), 3000);
      }
    } catch { /* 忽略损坏草稿 */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  // 自动保存草稿（防抖 1.5s，随输入变化触发）
  useEffect(() => {
    if (editing === null) return;
    const key = 'blog_draft_' + (editing === 'new' ? 'new' : editing);
    const t = setTimeout(() => {
      try { localStorage.setItem(key, JSON.stringify(form)); } catch { /* 存储满忽略 */ }
    }, 1500);
    return () => clearTimeout(t);
  }, [form, editing]);

  // 保存/发布成功清除草稿
  function clearDraft() {
    const key = 'blog_draft_' + (editing === 'new' ? 'new' : editing);
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }

  async function submit(published) {
    if (saving) return;
    if (!form.title.trim()) {
      setSaveError('标题不能为空');
      return;
    }
    setSaving(true);
    setSaveError('');
    const payload = {
      title: form.title.trim(),
      slug: form.slug.trim(),
      tags: form.tags
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean),
      excerpt: form.excerpt.trim(),
      content: form.content,
      published,
      collection_id: form.collection_id || null
    };
    try {
      if (editing === 'new') {
        await createBlogPost(payload);
      } else {
        await updateBlogPost(editing, payload);
      }
      clearDraft();
      await load();
      setEditing(null);
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(post) {
    if (!window.confirm(`确定删除「${post.title}」？此操作不可恢复。`)) return;
    try {
      await deleteBlogPost(post.id);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  // ---- 合集管理 ----
  function startNewCollection() {
    setCollectionForm(EMPTY_COLLECTION_FORM);
    setCollectionError('');
    setEditingCollection('new');
  }

  function startEditCollection(c) {
    setCollectionForm({
      name: c.name,
      slug: c.slug,
      description: c.description || ''
    });
    setCollectionError('');
    setEditingCollection(c.id);
  }

  function cancelCollectionEdit() {
    setEditingCollection(null);
    setCollectionError('');
  }

  function setCollectionField(k, v) {
    setCollectionForm((f) => ({ ...f, [k]: v }));
  }

  // 合集表单：新建/编辑共用，保存后刷新合集列表
  async function submitCollection() {
    if (savingCollection) return;
    if (!collectionForm.name.trim()) {
      setCollectionError('合集名称不能为空');
      return;
    }
    setSavingCollection(true);
    setCollectionError('');
    const payload = {
      name: collectionForm.name.trim(),
      slug: collectionForm.slug.trim(),
      description: collectionForm.description.trim()
    };
    try {
      if (editingCollection === 'new') {
        await createBlogCollection(payload);
      } else {
        await updateBlogCollection(editingCollection, payload);
      }
      await loadCollections();
      setEditingCollection(null);
    } catch (e) {
      setCollectionError(e.message);
    } finally {
      setSavingCollection(false);
    }
  }

  // 删除合集：二次确认（解除关联不可恢复），完成后同时刷新文章列表（合集列变化）
  async function removeCollection(c) {
    if (!window.confirm(`确定删除合集「${c.name}」？`)) return;
    if (!window.confirm(`再次确认：删除合集「${c.name}」将解除该合集下所有文章的关联，此操作不可恢复。`)) return;
    try {
      await deleteBlogCollection(c.id);
      await loadCollections();
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  if (editingCollection !== null) {
    return (
      <div className="system blog-admin">
        <div className="system-head">
          <h2>{editingCollection === 'new' ? '新建合集' : '编辑合集'}</h2>
          <button className="btn-ghost" onClick={cancelCollectionEdit} disabled={savingCollection}>
            ← 返回
          </button>
        </div>

        <div className="blog-editor">
          <label className="blog-field">
            <span className="blog-label">名称 *</span>
            <input
              className="input"
              value={collectionForm.name}
              onChange={(e) => setCollectionField('name', e.target.value)}
              placeholder="合集名称"
              autoFocus
            />
          </label>

          <label className="blog-field">
            <span className="blog-label">Slug</span>
            <input
              className="input"
              value={collectionForm.slug}
              onChange={(e) => setCollectionField('slug', e.target.value)}
              placeholder="留空自动生成"
            />
          </label>

          <label className="blog-field">
            <span className="blog-label">描述</span>
            <textarea
              className="input blog-excerpt"
              rows={3}
              value={collectionForm.description}
              onChange={(e) => setCollectionField('description', e.target.value)}
              placeholder="合集简介（列表页展示）"
            />
          </label>

          {collectionError && <div className="error">{collectionError}</div>}

          <div className="blog-actions">
            <button className="btn-ghost" onClick={cancelCollectionEdit} disabled={savingCollection}>
              取消
            </button>
            <button className="btn-primary" onClick={submitCollection} disabled={savingCollection}>
              {savingCollection ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (editing !== null) {
    return (
      <div className="system blog-admin">
        <div className="system-head">
          <h2>{editing === 'new' ? '新建文章' : '编辑文章'}</h2>
          <button className="btn-ghost" onClick={cancelEdit} disabled={saving}>
            ← 返回列表
          </button>
        </div>

        <div className="blog-editor">
          <label className="blog-field">
            <span className="blog-label">标题 *</span>
            <input
              className="input"
              value={form.title}
              onChange={(e) => setField('title', e.target.value)}
              placeholder="文章标题"
              autoFocus
            />
          </label>

          <label className="blog-field">
            <span className="blog-label">Slug</span>
            <input
              className="input"
              value={form.slug}
              onChange={(e) => setField('slug', e.target.value)}
              placeholder="留空自动生成（如 my-first-post）"
            />
          </label>

          <label className="blog-field">
            <span className="blog-label">标签</span>
            <input
              className="input"
              value={form.tags}
              onChange={(e) => setField('tags', e.target.value)}
              placeholder="逗号分隔，如：前端, 生活"
            />
          </label>

          <label className="blog-field">
            <span className="blog-label">摘要</span>
            <textarea
              className="input blog-excerpt"
              rows={2}
              value={form.excerpt}
              onChange={(e) => setField('excerpt', e.target.value)}
              placeholder="列表页显示的摘要"
            />
          </label>

          <label className="blog-field">
            <span className="blog-label">所属合集</span>
            <select
              className="input blog-select"
              value={form.collection_id}
              onChange={(e) => setField('collection_id', e.target.value)}
            >
              <option value="">无合集</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <div className="blog-field">
            <span className="blog-label">内容（Markdown）</span>
            <div className="blog-toolbar">
              {!previewMode && (
                <button
                  type="button"
                  className="btn-ghost blog-img-btn"
                  onClick={() => imgInputRef.current && imgInputRef.current.click()}
                >
                  插图
                </button>
              )}
              <input
                ref={imgInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={onPickImage}
              />
              <button
                type="button"
                className={'btn-ghost blog-img-btn' + (previewMode ? ' active' : '')}
                onClick={() => setPreviewMode((v) => !v)}
              >
                {previewMode ? '编辑' : '预览'}
              </button>
              {draftNotice && <span className="blog-draft-notice">{draftNotice}</span>}
            </div>
            {previewMode ? (
              <div
                className="input blog-preview"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            ) : (
              <textarea
                ref={contentRef}
                className="input blog-content"
                rows={14}
                value={form.content}
                onChange={(e) => setField('content', e.target.value)}
                placeholder="支持 Markdown 语法"
              />
            )}
          </div>

          <label className="blog-publish">
            <input
              type="checkbox"
              checked={form.published}
              onChange={(e) => setField('published', e.target.checked)}
            />
            <span>发布状态（勾选为已发布，否则保存为草稿）</span>
          </label>

          {saveError && <div className="error">{saveError}</div>}

          <div className="blog-actions">
            <button className="btn-ghost" onClick={cancelEdit} disabled={saving}>
              取消
            </button>
            <button className="btn-ghost" onClick={() => submit(form.published)} disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
            <button className="btn-primary" onClick={() => submit(true)} disabled={saving}>
              {saving ? '保存中…' : '发布'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="system blog-admin">
      <div className="system-head">
        <h2>博客管理</h2>
        <div className="blog-head-right">
          <div className="tabs blog-view-tabs">
            <button
              className={'tab' + (view === 'posts' ? ' active' : '')}
              onClick={() => setView('posts')}
            >
              文章
            </button>
            <button
              className={'tab' + (view === 'collections' ? ' active' : '')}
              onClick={() => setView('collections')}
            >
              合集
            </button>
          </div>
          {view === 'posts' ? (
            <button className="btn-primary" onClick={startNew}>
              ＋ 新建文章
            </button>
          ) : (
            <button className="btn-primary" onClick={startNewCollection}>
              ＋ 新建合集
            </button>
          )}
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {view === 'posts' ? (
        loading ? (
          <div className="empty">加载中…</div>
        ) : posts.length === 0 ? (
          <div className="empty">暂无文章，点击右上角「新建文章」开始创作</div>
        ) : (
          <div className="blog-table-wrap">
            <table className="blog-table">
              <thead>
                <tr>
                  <th>标题</th>
                  <th>状态</th>
                  <th>日期</th>
                  <th>标签</th>
                  <th className="blog-ops">操作</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((p) => (
                  <tr key={p.id}>
                    <td className="blog-title">
                      {p.title}
                      {p.collection && (
                        <span className="blog-collection-tag">合集：{p.collection.name}</span>
                      )}
                    </td>
                    <td>
                      <span className={'blog-status ' + (p.published ? 'published' : 'draft')}>
                        {p.published ? '已发布' : '草稿'}
                      </span>
                    </td>
                    <td className="muted">{p.updated_at || p.created_at}</td>
                    <td>
                      <div className="blog-tags">
                        {(p.tags || []).map((t) => (
                          <span className="chip" key={t}>
                            {t}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="blog-ops">
                      <button className="link-btn" onClick={() => startEdit(p)}>
                        编辑
                      </button>
                      <button className="link-btn danger" onClick={() => remove(p)}>
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : collections.length === 0 ? (
        <div className="empty">暂无合集，点击右上角「新建合集」开始整理文章</div>
      ) : (
        <div className="blog-table-wrap">
          <table className="blog-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>描述</th>
                <th>文章数</th>
                <th className="blog-ops">操作</th>
              </tr>
            </thead>
            <tbody>
              {collections.map((c) => (
                <tr key={c.id}>
                  <td className="blog-title">{c.name}</td>
                  <td className="muted">{c.description || '—'}</td>
                  <td>{c.post_count}</td>
                  <td className="blog-ops">
                    <button className="link-btn" onClick={() => startEditCollection(c)}>
                      编辑
                    </button>
                    <button className="link-btn danger" onClick={() => removeCollection(c)}>
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="blog-foot">
        <a href={`/blog/${form.slug || ''}`} target="_blank" rel="noreferrer">
          在 /blog 查看
        </a>
      </div>
    </div>
  );
}
