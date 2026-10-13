import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent
} from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography
} from 'antd';
import type { TableProps } from 'antd';
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
} from '../api';
import type { BlogCollection, BlogCollectionInput, BlogPost, BlogPostInput } from '../api';
import { siteUrl } from '../siteUrl';
import MarkdownEditor from './MarkdownEditor';
import type { MarkdownEditorApi } from './MarkdownEditor';

/** 文章表单（tags 用逗号串编辑，提交时拆分） */
interface BlogForm {
  title: string;
  subtitle: string;
  slug: string;
  public_id: string;
  tags: string;
  excerpt: string;
  content: string;
  published: boolean;
  /** 下拉选项值由 React 转成字符串，编辑时可能拿到数字 id */
  collection_id: number | string;
}

/** 合集表单 */
interface CollectionForm {
  name: string;
  slug: string;
  public_id: string;
  description: string;
}

const EMPTY_FORM: BlogForm = {
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
const EMPTY_COLLECTION_FORM: CollectionForm = {
  name: '',
  slug: '',
  public_id: '',
  description: ''
};

export default function BlogAdmin() {
  const { message, modal } = App.useApp();
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const editorApiRef = useRef<MarkdownEditorApi | null>(null); // MarkdownEditor 命令式 API（插图光标插入用）
  const imgInputRef = useRef<HTMLInputElement | null>(null); // 插图文件选择
  const previewRef = useRef<HTMLDivElement | null>(null); // 预览滚动容器（滚动同步用）
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // editing === null 列表视图；'new' 新建；数字 = 编辑对应文章 id
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [form, setForm] = useState<BlogForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  // 列表视图：'posts' 文章 / 'collections' 合集
  const [view, setView] = useState('posts');
  // 正文视图模式：'edit' 仅编辑 / 'split' 分栏 / 'preview' 仅预览
  const [viewMode, setViewMode] = useState('split');
  // 编辑器全屏/专注模式
  const [fullscreen, setFullscreen] = useState(false);
  // 合集管理：列表 / 表单（'new' 或合集 id）
  const [collections, setCollections] = useState<BlogCollection[]>([]);
  const [editingCollection, setEditingCollection] = useState<number | 'new' | null>(null);
  const [collectionForm, setCollectionForm] = useState<CollectionForm>(EMPTY_COLLECTION_FORM);
  const [savingCollection, setSavingCollection] = useState(false);
  const [collectionError, setCollectionError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getBlogAdminPosts();
      setPosts(data.list || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCollections = useCallback(async () => {
    try {
      const data = await getBlogAdminCollections();
      setCollections(data.list || []);
    } catch {
      // 合集加载失败不阻塞文章管理，编辑器下拉为空即可
    }
  }, []);

  useEffect(() => {
    load();
    loadCollections();
  }, [load, loadCollections]);

  // 预览 HTML：marked 渲染 + DOMPurify 消毒（与博客详情一致，Swiss 排版由 CSS 控制）
  const previewHtml = useMemo(
    () => DOMPurify.sanitize(marked.parse(form.content || '') as string),
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

  function startEdit(post: BlogPost) {
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

  function setField<K extends keyof BlogForm>(k: K, v: BlogForm[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // 选择图片上传 → 在编辑器光标处插入![](relative url)（相对路径，换域名也正确）
  async function onPickImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    await handleUploadImage(file);
  }

  // 粘贴/拖拽/文件选择共用的图片上传插入
  async function handleUploadImage(file: File) {
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
      message.success('图片已插入');
    } catch (err) {
      setSaveError('图片上传失败: ' + (err as Error).message);
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
        message.info('已恢复未保存的草稿');
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

  // 分栏模式滚动同步：按滚动百分比在编辑区与预览区之间双向同步
  useEffect(() => {
    if (viewMode !== 'split') return undefined;
    const api = editorApiRef.current;
    const preview = previewRef.current;
    if (!api || !preview || !api.scrollDOM) return undefined;
    const editorDOM = api.scrollDOM;
    // 记录程序写入的 scrollTop，对应源下一次自身触发的滚动事件视为程序回声，跳过防止回环
    const expected: { editor: number | null; preview: number | null } = {
      editor: null,
      preview: null
    };
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  // 工具栏按钮执行：仅预览模式先切回分栏，保证编辑器可见
  function runTool(fn: (api: MarkdownEditorApi) => void) {
    return () => {
      if (viewMode === 'preview') setViewMode('split');
      const api = editorApiRef.current;
      if (api) fn(api);
    };
  }

  const modKey = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

  async function submit(published: boolean) {
    if (saving) return;
    if (!form.title.trim()) {
      setSaveError('标题不能为空');
      return;
    }
    setSaving(true);
    setSaveError('');
    const payload: BlogPostInput = {
      title: form.title.trim(),
      subtitle: form.subtitle.trim(),
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
        await updateBlogPost(editing as number, payload);
      }
      clearDraft();
      await load();
      setEditing(null);
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(post: BlogPost) {
    try {
      await deleteBlogPost(post.id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // 打开文章页（新标签）：已发布走公开地址，草稿先取带短时效预览令牌的地址。
  // 草稿要先请求令牌，故先同步开一个空标签再改地址 —— 避免 await 之后被浏览器当弹窗拦截。
  async function openPost(post: BlogPost) {
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
      setError(`生成草稿预览链接失败：${(e as Error).message}`);
    }
  }

  // ---- 合集管理 ----
  function startNewCollection() {
    setCollectionForm(EMPTY_COLLECTION_FORM);
    setCollectionError('');
    setEditingCollection('new');
  }

  function startEditCollection(c: BlogCollection) {
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
    if (savingCollection) return;
    setEditingCollection(null);
    setCollectionError('');
  }

  function setCollectionField<K extends keyof CollectionForm>(k: K, v: CollectionForm[K]) {
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
    const payload: BlogCollectionInput = {
      name: collectionForm.name.trim(),
      slug: collectionForm.slug.trim(),
      description: collectionForm.description.trim()
    };
    try {
      if (editingCollection === 'new') {
        await createBlogCollection(payload);
      } else {
        await updateBlogCollection(editingCollection as number, payload);
      }
      await loadCollections();
      setEditingCollection(null);
    } catch (e) {
      setCollectionError((e as Error).message);
    } finally {
      setSavingCollection(false);
    }
  }

  // 删除合集：二次确认（解除关联不可恢复），完成后同时刷新文章列表（合集列变化）
  function confirmRemoveCollection(c: BlogCollection) {
    modal.confirm({
      title: `再次确认：删除合集「${c.name}」将解除该合集下所有文章的关联，此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => removeCollection(c)
    });
  }

  async function removeCollection(c: BlogCollection) {
    try {
      await deleteBlogCollection(c.id);
      await loadCollections();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (editing !== null) {
    return (
      <div className="system blog-admin">
        <div className="system-head">
          <Typography.Title level={4} style={{ margin: 0 }}>
            {editing === 'new' ? '新建文章' : '编辑文章'}
          </Typography.Title>
          <Space>
            {form.public_id && (
              <Button
                type="link"
                href={siteUrl(`/blog/${form.public_id}`)}
                target="_blank"
                rel="noreferrer"
              >
                在 /blog 查看
              </Button>
            )}
            <Button onClick={cancelEdit} disabled={saving}>
              ← 返回列表
            </Button>
          </Space>
        </div>

        <Form layout="vertical" style={{ maxWidth: 720 }}>
          <Form.Item label="标题" required>
            <Input
              value={form.title}
              onChange={(e) => setField('title', e.target.value)}
              placeholder="文章标题"
              autoFocus
            />
          </Form.Item>

          <Form.Item label="副标题">
            <Input
              value={form.subtitle || ''}
              onChange={(e) => setField('subtitle', e.target.value)}
              placeholder="副标题"
            />
          </Form.Item>

          <Form.Item
            label="文章 ID"
            tooltip="URL 标识：/blog/&lt;文章 ID&gt;，保存后固定不变，改标题不影响"
          >
            <Input
              value={form.public_id || ''}
              readOnly
              disabled
              placeholder="保存后自动生成（雪花 ID，URL 用它）"
            />
          </Form.Item>

          <Form.Item label="标签">
            <Input
              value={form.tags}
              onChange={(e) => setField('tags', e.target.value)}
              placeholder="逗号分隔，如：前端, 生活"
            />
          </Form.Item>

          <Form.Item label="摘要">
            <Input.TextArea
              rows={2}
              value={form.excerpt}
              onChange={(e) => setField('excerpt', e.target.value)}
              placeholder="列表页显示的摘要"
            />
          </Form.Item>

          <Form.Item label="所属合集">
            <Select
              value={
                form.collection_id === '' || form.collection_id == null
                  ? ''
                  : String(form.collection_id)
              }
              onChange={(v) => setField('collection_id', v)}
              options={[
                { value: '', label: '无合集' },
                ...collections.map((c) => ({ value: String(c.id), label: c.name }))
              ]}
            />
          </Form.Item>

          <Form.Item label="内容（Markdown）">
            <div className={'blog-md-wrap' + (fullscreen ? ' fullscreen' : '')}>
              <div className="blog-md-toolbar">
                <Space wrap size={4}>
                  <Button
                    size="small"
                    title={'一级标题 ' + modKey + '⇧1'}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={runTool((api) => api.heading(1))}
                  >
                    H1
                  </Button>
                  <Button
                    size="small"
                    title={'二级标题 ' + modKey + '⇧2'}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={runTool((api) => api.heading(2))}
                  >
                    H2
                  </Button>
                  <Button
                    size="small"
                    title={'三级标题 ' + modKey + '⇧3'}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={runTool((api) => api.heading(3))}
                  >
                    H3
                  </Button>
                  <Button
                    size="small"
                    title={'粗体 ' + modKey + 'B'}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={runTool((api) => api.wrap('**', '**', '粗体'))}
                  >
                    B
                  </Button>
                  <Button
                    size="small"
                    title={'斜体 ' + modKey + 'I'}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={runTool((api) => api.wrap('*', '*', '斜体'))}
                  >
                    I
                  </Button>
                  <Button
                    size="small"
                    title={'行内代码 ' + modKey + 'E'}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={runTool((api) => api.wrap('`', '`', '代码'))}
                  >
                    ‹›
                  </Button>
                  <Button
                    size="small"
                    title="代码块"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={runTool((api) => api.insertBlock('```\n代码\n```'))}
                  >
                    ```
                  </Button>
                  <Button
                    size="small"
                    title="引用"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={runTool((api) => api.linePrefix('> '))}
                  >
                    ›
                  </Button>
                  <Button
                    size="small"
                    title="无序列表"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={runTool((api) => api.linePrefix('- '))}
                  >
                    •
                  </Button>
                  <Button
                    size="small"
                    title="有序列表"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={runTool((api) => api.orderedList())}
                  >
                    1.
                  </Button>
                  <Button
                    size="small"
                    title={'链接 ' + modKey + 'K'}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={runTool((api) => api.link())}
                  >
                    链接
                  </Button>
                  <Button
                    size="small"
                    title="表格"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={runTool((api) =>
                      api.insertBlock('| 列一 | 列二 | 列三 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |')
                    )}
                  >
                    表格
                  </Button>
                  <Button
                    size="small"
                    title="分隔线"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={runTool((api) => api.insertBlock('---'))}
                  >
                    —
                  </Button>
                </Space>
                <Space size={4} style={{ marginLeft: 'auto' }}>
                  <Button
                    size="small"
                    title="插入图片（支持粘贴 / 拖拽）"
                    onClick={() => imgInputRef.current && imgInputRef.current.click()}
                  >
                    插图
                  </Button>
                  <input
                    ref={imgInputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={onPickImage}
                  />
                  <Segmented
                    size="small"
                    value={viewMode}
                    onChange={(v) => setViewMode(String(v))}
                    options={[
                      { label: '编辑', value: 'edit' },
                      { label: '并排', value: 'split' },
                      { label: '预览', value: 'preview' }
                    ]}
                  />
                  <Button
                    size="small"
                    title={fullscreen ? '退出全屏（Esc）' : '全屏'}
                    onClick={() => setFullscreen((v) => !v)}
                  >
                    {fullscreen ? '退出全屏' : '全屏'}
                  </Button>
                </Space>
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
                <Typography.Text type="secondary">字符 {contentStats.chars}</Typography.Text>
                <Typography.Text type="secondary">字数 {contentStats.words}</Typography.Text>
                <Typography.Text type="secondary">阅读约 {contentStats.minutes} 分钟</Typography.Text>
              </div>
            </div>
          </Form.Item>

          <Form.Item>
            <Space>
              <Switch
                checked={form.published}
                onChange={(v) => setField('published', v)}
              />
              <span>发布状态（勾选为已发布，否则保存为草稿）</span>
            </Space>
          </Form.Item>

          {saveError && <Alert type="error" showIcon message={saveError} style={{ marginBottom: 16 }} />}

          <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={cancelEdit} disabled={saving}>
              取消
            </Button>
            <Button onClick={() => submit(form.published)} disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </Button>
            <Button type="primary" onClick={() => submit(true)} disabled={saving}>
              {saving ? '保存中…' : '发布'}
            </Button>
          </Space>
        </Form>
      </div>
    );
  }

  const postColumns: TableProps<BlogPost>['columns'] = [
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      sorter: (a, b) => a.title.localeCompare(b.title),
      render: (_value, p) => (
        <Space direction="vertical" size={2}>
          <Typography.Link
            href={siteUrl(`/blog/${p.public_id || p.slug}`)}
            title={p.published ? '打开文章页' : '打开文章页（草稿预览，链接 30 分钟内有效）'}
            onClick={(e) => {
              e.preventDefault();
              openPost(p);
            }}
          >
            {p.title}
          </Typography.Link>
          {p.collection && <Tag>合集：{p.collection.name}</Tag>}
        </Space>
      )
    },
    {
      title: '状态',
      dataIndex: 'published',
      key: 'status',
      render: (published: boolean) => (
        <Tag color={published ? 'green' : 'default'}>{published ? '已发布' : '草稿'}</Tag>
      )
    },
    {
      title: '日期',
      key: 'date',
      sorter: (a, b) =>
        (a.updated_at || a.created_at || '').localeCompare(b.updated_at || b.created_at || ''),
      render: (_value, p) => (
        <Typography.Text type="secondary">{p.updated_at || p.created_at}</Typography.Text>
      )
    },
    {
      title: '标签',
      dataIndex: 'tags',
      key: 'tags',
      render: (tags: string[] | undefined) => (
        <Space size={4} wrap>
          {(tags || []).map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </Space>
      )
    },
    {
      title: '操作',
      key: 'ops',
      width: 140,
      fixed: 'right',
      render: (_value, p) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => startEdit(p)}>
            编辑
          </Button>
          <Popconfirm
            title={`确定删除「${p.title}」？此操作不可恢复。`}
            okText="删除"
            cancelText="取消"
            onConfirm={() => remove(p)}
          >
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  const collectionColumns: TableProps<BlogCollection>['columns'] = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, c) => (
        <Typography.Link
          href={siteUrl(`/blog/collections/${c.public_id || c.slug}`)}
          target="_blank"
          rel="noreferrer"
          title="打开合集页"
        >
          {name}
        </Typography.Link>
      )
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      render: (description: string | undefined) => description || '—'
    },
    { title: '文章数', dataIndex: 'post_count', key: 'post_count' },
    {
      title: '操作',
      key: 'ops',
      width: 140,
      fixed: 'right',
      render: (_value, c) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => startEditCollection(c)}>
            编辑
          </Button>
          <Popconfirm
            title={`确定删除合集「${c.name}」？`}
            okText="删除"
            cancelText="取消"
            onConfirm={() => confirmRemoveCollection(c)}
          >
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <div className="system blog-admin">
      <div className="system-head">
        <Typography.Title level={4} style={{ margin: 0 }}>
          博客管理
        </Typography.Title>
        <Space>
          <Segmented
            value={view}
            onChange={(v) => setView(String(v))}
            options={[
              { label: '文章', value: 'posts' },
              { label: '合集', value: 'collections' }
            ]}
          />
          {view === 'posts' ? (
            <Button type="primary" onClick={startNew}>
              ＋ 新建文章
            </Button>
          ) : (
            <Button type="primary" onClick={startNewCollection}>
              ＋ 新建合集
            </Button>
          )}
        </Space>
      </div>

      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}

      {view === 'posts' ? (
        <Table<BlogPost>
          rowKey="id"
          columns={postColumns}
          dataSource={posts}
          loading={loading}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          locale={{ emptyText: '暂无文章，点击右上角「新建文章」开始创作' }}
          scroll={{ x: 'max-content' }}
        />
      ) : (
        <Table<BlogCollection>
          rowKey="id"
          columns={collectionColumns}
          dataSource={collections}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          locale={{ emptyText: '暂无合集，点击右上角「新建合集」开始整理文章' }}
          scroll={{ x: 'max-content' }}
        />
      )}

      <Modal
        title={editingCollection === 'new' ? '新建合集' : '编辑合集'}
        open={editingCollection !== null}
        onOk={submitCollection}
        onCancel={cancelCollectionEdit}
        okText="保存"
        cancelText="取消"
        confirmLoading={savingCollection}
        maskClosable={!savingCollection}
        destroyOnHidden
      >
        <Form layout="vertical">
          <Form.Item label="名称" required>
            <Input
              value={collectionForm.name}
              onChange={(e) => setCollectionField('name', e.target.value)}
              placeholder="合集名称"
              autoFocus
            />
          </Form.Item>
          <Form.Item
            label="合集 ID"
            tooltip="URL 标识：/blog/collections/&lt;合集 ID&gt;，保存后固定不变"
          >
            <Input
              value={collectionForm.public_id || ''}
              readOnly
              disabled
              placeholder="保存后自动生成（雪花 ID，URL 用它）"
            />
          </Form.Item>
          <Form.Item label="描述">
            <Input.TextArea
              rows={3}
              value={collectionForm.description}
              onChange={(e) => setCollectionField('description', e.target.value)}
              placeholder="合集简介（列表页展示）"
            />
          </Form.Item>
        </Form>
        {collectionError && <Alert type="error" showIcon message={collectionError} />}
      </Modal>
    </div>
  );
}
