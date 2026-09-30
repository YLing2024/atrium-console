import { useEffect, useRef, type MutableRefObject } from 'react';
import { EditorState, type Range, type SelectionRange } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  drawSelection,
  dropCursor,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder,
  rectangularSelection,
  crosshairCursor,
  type DecorationSet,
  type KeyBinding,
  type ViewUpdate
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, indentUnit, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { tags } from '@lezer/highlight';

const mdHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, color: 'var(--accent-ink)', fontWeight: '700' },
  { tag: tags.heading2, color: 'var(--accent-ink)', fontWeight: '700' },
  { tag: tags.heading3, color: 'var(--accent-ink)', fontWeight: '700' },
  { tag: tags.heading, color: 'var(--accent-ink)', fontWeight: '600' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, color: 'var(--muted)', textDecoration: 'line-through' },
  { tag: tags.monospace, color: 'var(--accent)' },
  { tag: tags.link, color: 'var(--accent)', textDecoration: 'underline' },
  { tag: tags.url, color: 'var(--accent)' },
  { tag: tags.labelName, color: 'var(--faint)' },
  { tag: tags.quote, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: tags.contentSeparator, color: 'var(--faint)' },
  { tag: tags.processingInstruction, color: 'var(--faint)' }
]);

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--fg)',
    backgroundColor: 'var(--surface)',
    fontSize: '13px'
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.7'
  },
  '.cm-content': {
    caretColor: 'var(--accent)',
    paddingBottom: '48px'
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--accent)',
    borderLeftWidth: '2px'
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--accent-soft)'
  },
  '.cm-activeLine': { backgroundColor: 'var(--surface-2)' },
  '.cm-gutters': {
    backgroundColor: 'var(--surface)',
    color: 'var(--faint)',
    border: 'none',
    borderRight: '1px solid var(--line-soft)'
  },
  '.cm-activeLineGutter': { backgroundColor: 'var(--surface-2)', color: 'var(--muted)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 12px', minWidth: '32px' },
  '.cm-line': { padding: '0 14px' },
  '.cm-placeholder': { color: 'var(--faint)' },
  '& .cm-md-code-line': { backgroundColor: 'var(--surface-2)' },
  '.cm-tooltip': {
    border: '1px solid var(--border)',
    backgroundColor: 'var(--surface-2)',
    color: 'var(--fg)'
  }
});

// 代码块整段加底色：按语法树找到 FencedCode/CodeBlock，给每个所属行挂 line 装饰
const mdCodeLine = Decoration.line({ class: 'cm-md-code-line' });

function buildCodeBlockDecorations(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    from: 0,
    to: state.doc.length,
    enter: (node) => {
      if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
        const first = state.doc.lineAt(node.from).number;
        const last = state.doc.lineAt(node.to).number;
        for (let n = first; n <= last; n++) {
          ranges.push(mdCodeLine.range(state.doc.line(n).from));
        }
        return false;
      }
      return undefined;
    }
  });
  return Decoration.set(ranges, true);
}

const mdCodeBlockHighlight = ViewPlugin.fromClass(
  class {
    declare decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildCodeBlockDecorations(view.state);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildCodeBlockDecorations(update.state);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

function lineRange(state: EditorState, sel: SelectionRange): number[] {
  return [
    state.doc.lineAt(sel.from).number,
    state.doc.lineAt(sel.to).number
  ];
}

function replaceSelectionWith(view: EditorView, text: string) {
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    scrollIntoView: true
  });
  view.focus();
}

function cmdWrap(view: EditorView, before: string, after: string, placeholderText: string) {
  const state = view.state;
  const { from, to } = state.selection.main;
  const selected = state.sliceDoc(from, to);
  if (selected) {
    view.dispatch({
      changes: { from, to, insert: before + selected + after },
      selection: { anchor: from + before.length + selected.length + after.length },
      scrollIntoView: true
    });
  } else {
    view.dispatch({
      changes: { from, to, insert: before + placeholderText + after },
      selection: { anchor: from + before.length, head: from + before.length + placeholderText.length },
      scrollIntoView: true
    });
  }
  view.focus();
}

function cmdHeading(view: EditorView, level: number) {
  const state = view.state;
  const { from, to } = state.selection.main;
  const [first, last] = [state.doc.lineAt(from).number, state.doc.lineAt(to).number];
  const changes: { from: number; to: number; insert: string }[] = [];
  for (let n = first; n <= last; n++) {
    const line = state.doc.line(n);
    const m = line.text.match(/^#{1,6}(\s+|$)/);
    if (m) {
      const hashes = m[0].trim().length;
      if (hashes === level) {
        changes.push({ from: line.from, to: line.from + m[0].length, insert: '' });
      } else {
        changes.push({ from: line.from, to: line.from + hashes, insert: '#'.repeat(level) });
      }
    } else {
      changes.push({ from: line.from, to: line.from, insert: '#'.repeat(level) + ' ' });
    }
  }
  view.dispatch({ changes, scrollIntoView: true });
  view.focus();
}

function cmdLinePrefix(view: EditorView, prefix: string) {
  const state = view.state;
  const { from, to } = state.selection.main;
  const [first, last] = [state.doc.lineAt(from).number, state.doc.lineAt(to).number];
  let allHave = true;
  for (let n = first; n <= last; n++) {
    if (!state.doc.line(n).text.startsWith(prefix)) {
      allHave = false;
      break;
    }
  }
  const changes: { from: number; to: number; insert: string }[] = [];
  for (let n = first; n <= last; n++) {
    const line = state.doc.line(n);
    if (allHave) {
      changes.push({ from: line.from, to: line.from + prefix.length, insert: '' });
    } else if (!line.text.startsWith(prefix)) {
      changes.push({ from: line.from, to: line.from, insert: prefix });
    }
  }
  view.dispatch({ changes, scrollIntoView: true });
  view.focus();
}

function cmdOrderedList(view: EditorView) {
  const state = view.state;
  const { from, to } = state.selection.main;
  const [first, last] = [state.doc.lineAt(from).number, state.doc.lineAt(to).number];
  const re = /^\d+\.\s/;
  let allHave = true;
  for (let n = first; n <= last; n++) {
    if (!re.test(state.doc.line(n).text)) {
      allHave = false;
      break;
    }
  }
  const changes: { from: number; to: number; insert: string }[] = [];
  let idx = 1;
  for (let n = first; n <= last; n++) {
    const line = state.doc.line(n);
    const m = line.text.match(re);
    if (allHave && m) {
      changes.push({ from: line.from, to: line.from + m[0].length, insert: '' });
    } else if (!m) {
      changes.push({ from: line.from, to: line.from, insert: idx++ + '. ' });
    }
  }
  view.dispatch({ changes, scrollIntoView: true });
  view.focus();
}

function cmdLink(view: EditorView) {
  const state = view.state;
  const { from, to } = state.selection.main;
  const text = state.sliceDoc(from, to);
  if (text) {
    view.dispatch({
      changes: { from, to, insert: '[' + text + '](url)' },
      selection: { anchor: from + text.length + 3, head: from + text.length + 6 },
      scrollIntoView: true
    });
  } else {
    view.dispatch({
      changes: { from, to, insert: '[链接文字](url)' },
      selection: { anchor: from + 1, head: from + 5 },
      scrollIntoView: true
    });
  }
  view.focus();
}

function cmdInsertBlock(view: EditorView, text: string) {
  const state = view.state;
  const { from, to } = state.selection.main;
  const line = state.doc.lineAt(from);
  const insert = (line.text ? '\n' : '') + text + '\n';
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    scrollIntoView: true
  });
  view.focus();
}

const editorKeyBindings: KeyBinding[] = [
  { key: 'Mod-b', run: (v) => (cmdWrap(v, '**', '**', '粗体'), true) },
  { key: 'Mod-i', run: (v) => (cmdWrap(v, '*', '*', '斜体'), true) },
  { key: 'Mod-e', run: (v) => (cmdWrap(v, '`', '`', '代码'), true) },
  { key: 'Mod-k', run: (v) => (cmdLink(v), true) },
  { key: 'Mod-Shift-1', run: (v) => (cmdHeading(v, 1), true) },
  { key: 'Mod-Shift-2', run: (v) => (cmdHeading(v, 2), true) },
  { key: 'Mod-Shift-3', run: (v) => (cmdHeading(v, 3), true) },
  { key: 'Mod-Shift-!', run: (v) => (cmdHeading(v, 1), true) },
  { key: 'Mod-Shift-@', run: (v) => (cmdHeading(v, 2), true) },
  { key: 'Mod-Shift-#', run: (v) => (cmdHeading(v, 3), true) }
];

/** 供父组件命令式调用的编辑器 API（工具栏 / 插图光标插入） */
export interface MarkdownEditorApi {
  insert: (text: string) => void;
  replaceSelection: (text: string) => void;
  wrap: (before: string, after: string, ph: string) => void;
  heading: (level: number) => void;
  linePrefix: (prefix: string) => void;
  orderedList: () => void;
  link: () => void;
  insertBlock: (text: string) => void;
  getText: () => string;
  focus: () => void;
  scrollDOM: HTMLElement;
}

function buildApi(view: EditorView): MarkdownEditorApi {
  return {
    insert: (text) => replaceSelectionWith(view, text),
    replaceSelection: (text) => replaceSelectionWith(view, text),
    wrap: (before, after, ph) => cmdWrap(view, before, after, ph),
    heading: (level) => cmdHeading(view, level),
    linePrefix: (prefix) => cmdLinePrefix(view, prefix),
    orderedList: () => cmdOrderedList(view),
    link: () => cmdLink(view),
    insertBlock: (text) => cmdInsertBlock(view, text),
    getText: () => view.state.doc.toString(),
    focus: () => view.focus(),
    scrollDOM: view.scrollDOM
  };
}

export default function MarkdownEditor({
  value = '',
  onChange,
  apiRef,
  onUploadImage
}: {
  value?: string;
  onChange?: (text: string) => void;
  apiRef?: MutableRefObject<MarkdownEditorApi | null>;
  onUploadImage?: (file: File) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const cbRef = useRef<{
    onChange?: (text: string) => void;
    onUploadImage?: (file: File) => void;
  }>({});
  cbRef.current = { onChange, onUploadImage };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value || '',
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          dropCursor(),
          rectangularSelection(),
          crosshairCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentUnit.of('  '),
          EditorView.lineWrapping,
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          syntaxHighlighting(mdHighlightStyle),
          mdCodeBlockHighlight,
          editorTheme,
          placeholder('支持 Markdown 语法'),
          keymap.of(editorKeyBindings),
          keymap.of([indentWithTab]),
          keymap.of(historyKeymap),
          keymap.of(defaultKeymap),
          EditorView.domEventHandlers({
            paste(event) {
              const uploader = cbRef.current.onUploadImage;
              if (!uploader || !event.clipboardData) return false;
              const imgs = Array.from(event.clipboardData.files).filter((f) =>
                f.type.startsWith('image/')
              );
              if (!imgs.length) return false;
              event.preventDefault();
              imgs.forEach(uploader);
              return true;
            },
            drop(event, v) {
              const uploader = cbRef.current.onUploadImage;
              if (!uploader || !event.dataTransfer) return false;
              const imgs = Array.from(event.dataTransfer.files).filter((f) =>
                f.type.startsWith('image/')
              );
              if (!imgs.length) return false;
              event.preventDefault();
              const pos = v.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos != null) v.dispatch({ selection: { anchor: pos } });
              imgs.forEach(uploader);
              return true;
            }
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && typeof cbRef.current.onChange === 'function') {
              cbRef.current.onChange(update.state.doc.toString());
            }
          })
        ]
      })
    });
    viewRef.current = view;
    if (apiRef) apiRef.current = buildApi(view);
    return () => {
      view.destroy();
      viewRef.current = null;
      if (apiRef) apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部 value 变化时同步进编辑器；内容一致则跳过，避免输入回环/光标跳位
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const next = value || '';
    if (view.state.doc.toString() !== next) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next }
      });
    }
  }, [value]);

  return <div className="blog-cm" ref={hostRef} />;
}
