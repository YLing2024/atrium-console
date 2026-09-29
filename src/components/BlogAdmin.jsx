import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import {
  getBlogAdminPosts,
  createBlogPost,
  updateBlogPost,
  deleteBlogPost,
  getBlogPostPreviewLink,
  uploadBlogImage,
  getBlogAdminCollections,
  createBlogCollection,
  updateBlogCollection,
  deleteBlogCollection
} from '../api.js';
import { siteUrl } from '../siteUrl.js';
import MarkdownEditor from './MarkdownEditor.jsx';

const EMPTY_FORM = {
  title: '',
  subtitle: '',
  slug: '',
  public_id: '',
  tags: '',
  excerpt: '',
  content: '',
  published: false,
  collection_id: ''
};
const EMPTY_COLLECTION_FORM = { name: '', slug: '', public_id: '', description: '' };

export default function BlogAdmin() {
  const [posts, setPosts] = useState([]);
  const editorApiRef = useRef(null); // MarkdownEditor 命令式 API（插图光标插入用）
  const imgInputRef = useRef(null); // 插图文件选择
  const previewRef = useRef(null); // 预览滚动容器（滚动同步用）
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
  // 正文视图模式：'edit' 仅编辑 / 'split' 分栏 / 'preview' 仅预览
  const [viewMode, setViewMode] = useState('split');
  // 编辑器全屏/专注模式
  const [fullscreen, setFullscreen] = useState(false);
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

  // 字数统计：中文按字计、英文按词计；阅读时长按 300 字/分钟
  const contentStats = useMemo(() => {
    const text = form.content || '';
    const cjk = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) || []).length;
    const latinWords = (
      text.replace(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, ' ').match(/[A-Za-z0-9_]+/g) || []
    ).length;
    const words = cjk + latinWords;
    return {
      chars: text.length,
      words,
      minutes: words ? Math.max(1, Math.round(words / 300)) : 0
    };
  }, [form.content]);

  function startNew() {
    setForm(EMPTY_FORM);
    setSaveError('');
    setEditing('new');
  }

  function startEdit(post) {
    setForm({
      title: post.title,
      subtitle: post.subtitle || '',
      slug: post.slug,
      public_id: post.public_id || '',
      tags: (post.tags || []).join(', '),
      excerpt: post.excerpt || '',
      content: post.content || '',
      published: !!post.published,
      collection_id: post.collection ? post.collection.id : ''
    });
    setSaveError('');
    setEditing(post.id);
    setViewMode('split');
  }

  function cancelEdit() {
    setEditing(null);
    setSaveError('');
    setViewMode('split');
  }

  function setField(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // 选择图片上传 → 在编辑器光标处插入![](relative url)（相对路径，换域名也正确）
  async function onPickImage(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    await handleUploadImage(file);
  }

  // 粘贴/拖拽/文件选择共用的图片上传插入
  async function handleUploadImage(file) {
    if (!file) return;
    try {
      const { url } = await uploadBlogImage(file);
      const alt = (file.name || '')
        .replace(/\.[^.]+$/, '')
        .replace(/[\[\]()"]/g, '')
        .trim();
      const markdown = `![${alt}](${url})`;
      if (editorApiRef.current) {
        editorApiRef.current.insert(markdown);
      } else {
        setField('content', (form.content ? form.content + '\n' : '') + markdown);
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
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  // 分栏模式滚动同步：按滚动百分比在编辑区与预览区之间双向同步
  useEffect(() => {
    if (viewMode !== 'split') return undefined;
    const api = editorApiRef.current;
    const preview = previewRef.current;
    if (!api || !preview || !api.scrollDOM) return undefined;
    const editorDOM = api.scrollDOM;
    // 记录程序写入的 scrollTop，对应源下一次自身触发的滚动事件视为程序回声，跳过防止回环
    const expected = { editor: null, preview: null };
    const onEditorScroll = () => {
      if (expected.editor != null && Math.abs(editorDOM.scrollTop - expected.editor) < 2) {
        expected.editor = null;
        return;
      }
      expected.editor = null;
      const sMax = editorDOM.scrollHeight - editorDOM.clientHeight;
      const tMax = preview.scrollHeight - preview.clientHeight;
      if (sMax <= 0 || tMax <= 0) return;
      const top = (editorDOM.scrollTop / sMax) * tMax;
      expected.preview = top;
      preview.scrollTop = top;
    };
    const onPreviewScroll = () => {
      if (expected.preview != null && Math.abs(preview.scrollTop - expected.preview) < 2) {
        expected.preview = null;
        return;
      }
      expected.preview = null;
      const sMax = editorDOM.scrollHeight - editorDOM.clientHeight;
      const tMax = preview.scrollHeight - preview.clientHeight;
      if (sMax <= 0 || tMax <= 0) return;
      const top = (preview.scrollTop / tMax) * sMax;
      expected.editor = top;
      editorDOM.scrollTop = top;
    };
    editorDOM.addEventListener('scroll', onEditorScroll, { passive: true });
    preview.addEventListener('scroll', onPreviewScroll, { passive: true });
    return () => {
      editorDOM.removeEventListener('scroll', onEditorScroll);
      preview.removeEventListener('scroll', onPreviewScroll);
    };
  }, [viewMode]);

  // 全屏模式下 Esc 退出
  useEffect(() => {
    if (!fullscreen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  // 工具栏按钮执行：仅预览模式先切回分栏，保证编辑器可见
  function runTool(fn) {
    return () => {
      if (viewMode === 'preview') setViewMode('split');
      const api = editorApiRef.current;
      if (api) fn(api);
    };
  }

  const modKey = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

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

  // 打开文章页（新标签）：已发布走公开地址，草稿先取带短时效预览令牌的地址。
  // 草稿要先请求令牌，故先同步开一个空标签再改地址 —— 避免 await 之后被浏览器当弹窗拦截。
  async function openPost(post) {
    const key = post.public_id || post.slug;
    if (post.published) {
      window.open(siteUrl(`/blog/${key}`), '_blank', 'noopener');
      return;
    }
    const win = window.open('', '_blank');
    try {
      const { url } = await getBlogPostPreviewLink(post.id);
      if (win) win.location.href = url;
      else window.open(url, '_blank', 'noopener');
    } catch (e) {
      if (win) win.close();
      setError(`生成草稿预览链接失败：${e.message}`);
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
      public_id: c.public_id || '',
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
            <span className="blog-label">合集 ID</span>
            <input
              className="input"
              value={collectionForm.public_id || ''}
              readOnly
              disabled
              placeholder="保存后自动生成（雪花 ID，URL 用它）"
              title="URL 标识：/blog/collections/&lt;合集 ID&gt;，保存后固定不变"
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
          <div className="blog-head-actions">
            {form.public_id && (
              <a
                className="btn-ghost"
                href={siteUrl(`/blog/${form.public_id}`)}
                target="_blank"
                rel="noreferrer"
              >
                在 /blog 查看
              </a>
            )}
            <button className="btn-ghost" onClick={cancelEdit} disabled={saving}>
              ← 返回列表
            </button>
          </div>
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
            <span className="blog-label">文章 ID</span>
            <input
              className="input"
              value={form.public_id || ''}
              readOnly
              disabled
              placeholder="保存后自动生成（雪花 ID，URL 用它）"
              title="URL 标识：/blog/&lt;文章 ID&gt;，保存后固定不变，改标题不影响"
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
            <div className={'blog-md-wrap' + (fullscreen ? ' fullscreen' : '')}>
              <div className="blog-toolbar blog-md-toolbar">
                <div className="blog-md-tools">
                  <button
                    type="button"
                    className="btn-ghost blog-tool-btn"
                    title={'一级标题 ' + modKey + '⇧1'}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={runTool((api) => api.heading(1))}
                  >
                    H1
                  </button>
                  <button
                    type="button"
                    className="btn-ghost blog-tool-btn"
                    title={'二级标题 ' + modKey + '⇧2'}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={runTool((api) => api.heading(2))}
                  >
                    H2
                  </button>
                  <button
                    type="button"
                    className="btn-ghost blog-tool-btn"
                    title={'三级标题 ' + modKey + '⇧3'}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={runTool((api) => api.heading(3))}
                  >
                    H3
                  </button>
                  <button
                    type="button"
                    className="btn-ghost blog-tool-btn blog-tool-bold"
                    title={'粗体 ' + modKey + 'B'}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={runTool((api) => api.wrap('**', '**', '粗体'))}
                  >
                    B
                  </button>
                  <button
                    type="button"
                    className="btn-ghost blog-tool-btn blog-tool-italic"
                    title={'斜体 ' + modKey + 'I'}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={runTool((api) => api.wrap('*', '*', '斜体'))}
                  >
                    I
                  </button>
                  <button
                    type="button"
                    className="btn-ghost blog-tool-btn"
                    title={'行内代码 ' + modKey + 'E'}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={runTool((api) => api.wrap('`', '`', '代码'))}
                  >
                    ‹›
                  </button>
                  <button
                    type="button"
                    className="btn-ghost blog-tool-btn"
                    title="代码块"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={runTool((api) => api.insertBlock('```\n代码\n```'))}
                  >
                    ```
                  </button>
                  <button
                    type="button"
                    className="btn-ghost blog-tool-btn"
                    title="引用"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={runTool((api) => api.linePrefix('> '))}
                  >
                    ›
                  </button>
                  <button
                    type="button"
                    className="btn-ghost blog-tool-btn"
                    title="无序列表"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={runTool((api) => api.linePrefix('- '))}
                  >
                    •
                  </button>
                  <button
                    type="button"
                    className="btn-ghost blog-tool-btn"
                    title="有序列表"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={runTool((api) => api.orderedList())}
                  >
                    1.
                  </button>
                  <button
                    type="button"
                    className="btn-ghost blog-tool-btn"
                    title={'链接 ' + modKey + 'K'}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={runTool((api) => api.link())}
                  >
                    链接
                  </button>
                  <button
                    type="button"
                    className="btn-ghost blog-tool-btn"
                    title="表格"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={runTool((api) =>
                      api.insertBlock('| 列一 | 列二 | 列三 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |')
                    )}
                  >
                    表格
                  </button>
                  <button
                    type="button"
                    className="btn-ghost blog-tool-btn"
                    title="分隔线"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={runTool((api) => api.insertBlock('---'))}
                  >
                    —
                  </button>
                </div>
                <div className="blog-md-tools blog-md-right">
                  <button
                    type="button"
                    className="btn-ghost blog-tool-btn"
                    title="插入图片（支持粘贴 / 拖拽）"
                    onClick={() => imgInputRef.current && imgInputRef.current.click()}
                  >
                    插图
                  </button>
                  <input
                    ref={imgInputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={onPickImage}
                  />
                  <button
                    type="button"
                    className={'btn-ghost blog-tool-btn' + (viewMode === 'edit' ? ' active' : '')}
                    title="仅编辑"
                    onClick={() => setViewMode('edit')}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    className={'btn-ghost blog-tool-btn' + (viewMode === 'split' ? ' active' : '')}
                    title="编辑并排预览"
                    onClick={() => setViewMode('split')}
                  >
                    并排
                  </button>
                  <button
                    type="button"
                    className={'btn-ghost blog-tool-btn' + (viewMode === 'preview' ? ' active' : '')}
                    title="仅预览"
                    onClick={() => setViewMode('preview')}
                  >
                    预览
                  </button>
                  <button
                    type="button"
                    className={'btn-ghost blog-tool-btn' + (fullscreen ? ' active' : '')}
                    title={fullscreen ? '退出全屏（Esc）' : '全屏'}
                    onClick={() => setFullscreen((v) => !v)}
                  >
                    {fullscreen ? '退出全屏' : '全屏'}
                  </button>
                </div>
                {draftNotice && <span className="blog-draft-notice">{draftNotice}</span>}
              </div>
              <div className={'blog-split mode-' + viewMode}>
                <div className="blog-edit-pane">
                  <MarkdownEditor
                    value={form.content}
                    onChange={(text) => setField('content', text)}
                    apiRef={editorApiRef}
                    onUploadImage={handleUploadImage}
                  />
                </div>
                <div
                  ref={previewRef}
                  className={'blog-preview blog-preview-pane' + (viewMode === 'edit' ? ' hidden' : '')}
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              </div>
              <div className="blog-statusbar">
                <span>字符 {contentStats.chars}</span>
                <span>字数 {contentStats.words}</span>
                <span>阅读约 {contentStats.minutes} 分钟</span>
              </div>
            </div>
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
                      <a
                        className="blog-title-link"
                        href={siteUrl(`/blog/${p.public_id || p.slug}`)}
                        title={p.published ? '打开文章页' : '打开文章页（草稿预览，链接 30 分钟内有效）'}
                        onClick={(e) => {
                          e.preventDefault();
                          openPost(p);
                        }}
                      >
                        {p.title}
                      </a>
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
                  <td className="blog-title">
                    <a
                      className="blog-title-link"
                      href={siteUrl(`/blog/collections/${c.public_id || c.slug}`)}
                      target="_blank"
                      rel="noreferrer"
                      title="打开合集页"
                    >
                      {c.name}
                    </a>
                  </td>
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
    </div>
  );
}