/**
 * component-system.ts — v5.0 nested note components (reference-based).
 *
 * A ```component fence now holds only `cmp_<id> [显示名称]`. The full tree is
 * stored in a separate plain markdown note at
 * `{workspace}/<dir>/<name>_<id>.md` with frontmatter (`kind: component`,
 * `id`, `name`) and a dedicated `component-tree` fence carrying the YAML tree.
 * The current note is just a caller: editing still happens in place, but
 * writes go to the external component note, never to the fence itself.
 *
 * One fence = one CodeMirror block widget; the widget recursively renders the
 * tree into DOM (nested Decoration.replace is not allowed in CM6). The pure
 * `renderComponentTree` is shared by Preview and the plain-text editor path.
 */
import yaml from 'js-yaml';
import { buildQueryHtml, type QuerySpec } from './queryBlock';

/** Directory (relative to workspace) holding component note files. */
export const COMPONENTS_DIR = '_components';
/** Fence language used INSIDE a component note to hold the YAML tree. */
export const COMPONENT_TREE_LANG = 'component-tree';

/** Bumped whenever a component note is saved / reloaded, so widgets that
 *  resolved the same `cmp_<id>` ref rebuild with the fresh tree. */
let componentDataVersion = 0;
const componentVersionListeners = new Set<() => void>();
export function bumpComponentDataVersion(): void {
  componentDataVersion += 1;
  for (const fn of Array.from(componentVersionListeners)) {
    try {
      fn();
    } catch (e) {
      console.error('[component-system] version listener failed', e);
    }
  }
}
export function getComponentDataVersion(): number {
  return componentDataVersion;
}
/** Subscribe to component note saves/reloads. Returns an unsubscribe fn. */
export function onComponentDataChange(fn: () => void): () => void {
  componentVersionListeners.add(fn);
  return () => componentVersionListeners.delete(fn);
}

/** Strict component ID: cmp_ + base36/underscore, no path chars. */
const ID_RE = /^cmp_[a-z0-9_]+$/i;
export function isValidComponentId(id: string): boolean {
  return ID_RE.test(id);
}

/** Reference parsed from a ```component fence body. */
export type ComponentFenceRef =
  | { kind: 'id'; id: string; name: string }
  | { kind: 'legacy' }
  | { kind: 'empty' };

export interface ComponentFile {
  id: string;
  name: string;
  tree: ComponentNode;
}

export type ComponentType = 'root' | 'stack' | 'grid' | 'tabs' | 'query' | 'callout' | 'text';

export const CONTAINER_TYPES: ComponentType[] = ['root', 'stack', 'grid', 'tabs'];

export interface ComponentNode {
  id: string;
  type: ComponentType;
  props: Record<string, unknown>;
  children?: ComponentNode[];
}

export interface ComponentDef {
  type: ComponentType;
  label: string;
  container: boolean;
  defaults: () => Record<string, unknown>;
  render: (props: Record<string, unknown>, childrenHtml: string) => string;
}

const esc = (v: unknown): string =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

/** Common box props applied as inline CSS to every component node. */
export const BOX_PROPS: Array<{ key: string; label: string; hint?: string }> = [
  { key: 'width', label: '宽度', hint: '如 100% / 320px（留空=自动）' },
  { key: 'minHeight', label: '最小高度', hint: '如 80px' },
  { key: 'padding', label: '内边距', hint: '如 8px / 8px 12px' },
  { key: 'margin', label: '外边距', hint: '如 0 0 12px' },
  { key: 'gap', label: '子项间距', hint: '容器有效，如 8px' },
];

/** Preset visual styles for components (style prop → `cs-style--*` class). */
export const STYLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'plain', label: 'Plain · 无装饰' },
  { value: 'card', label: 'Card · 卡片' },
  { value: 'outlined', label: 'Outlined · 描边' },
  { value: 'filled', label: 'Filled · 填充' },
  { value: 'elevated', label: 'Elevated · 悬浮' },
];
const styleClass = (p: Record<string, unknown>): string =>
  p.style && STYLE_OPTIONS.some((s) => s.value === p.style) ? ` cs-style--${String(p.style)}` : '';

/** Callout tone presets (tone prop → `cs-callout--*` class). */
export const TONE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'info', label: '信息 · 蓝' },
  { value: 'success', label: '成功 · 绿' },
  { value: 'warn', label: '警告 · 黄' },
  { value: 'danger', label: '危险 · 红' },
  { value: 'purple', label: '紫色' },
  { value: 'teal', label: '青色' },
  { value: 'gray', label: '灰色' },
  { value: 'accent', label: '主题色' },
];
const toneClass = (p: Record<string, unknown>): string =>
  TONE_OPTIONS.some((t) => t.value === p.tone) ? String(p.tone) : 'info';

function cssLen(v: unknown): string {
  const s = String(v ?? '');
  return /^\d+$/.test(s) ? `${s}px` : s;
}
function boxStyle(p: Record<string, unknown>): string {
  const parts: string[] = [];
  if (p.width) parts.push(`width:${esc(cssLen(p.width))}`);
  if (p.minHeight) parts.push(`min-height:${esc(cssLen(p.minHeight))}`);
  if (p.padding) parts.push(`padding:${esc(cssLen(p.padding))}`);
  if (p.margin) parts.push(`margin:${esc(cssLen(p.margin))}`);
  if (p.gap) parts.push(`gap:${esc(cssLen(p.gap))}`);
  return parts.join(';');
}
const styleAttr = (s: string): string => (s ? ` style="${s}"` : '');
const EMPTY_HINT = '<div class="cs-placeholder">空容器 — 用 ＋ 添加组件</div>';

// `render` outputs only the node's CONTENT semantics. Visual style + box props
// are applied ONCE by the outer wrapper (renderComponentTree / widget wrap),
// so a node never ends up with two style rings.
export const COMPONENT_DEFS: Record<ComponentType, ComponentDef> = {
  root: {
    type: 'root',
    label: '',
    container: true,
    defaults: () => ({}),
    render: (_p, children) => `<div class="cs-root-inner">${children}</div>`,
  },
  stack: {
    type: 'stack',
    label: '纵向容器',
    container: true,
    defaults: () => ({ gap: '8px' }),
    render: (_p, children) => `<div class="cs-stack">${children || EMPTY_HINT}</div>`,
  },
  grid: {
    type: 'grid',
    label: '网格容器',
    container: true,
    defaults: () => ({ columns: 2, gap: '8px' }),
    render: (p, children) => {
      const cols = Math.max(1, Math.min(6, Number(p.columns) || 2));
      return `<div class="cs-grid" data-cols="${cols}">${children || EMPTY_HINT}</div>`;
    },
  },
  tabs: {
    type: 'tabs',
    label: '标签页',
    container: true,
    defaults: () => ({}),
    render: (_p, children) => `<div class="cs-tabs"><div class="cs-tabs-body">${children || EMPTY_HINT}</div></div>`,
  },
  query: {
    type: 'query',
    label: '查询表格',
    container: false,
    defaults: () => ({ from: 'notes', columns: [] as string[], render: 'table' }),
    render: (p) => {
      try {
        return buildQueryHtml(p as unknown as QuerySpec);
      } catch (e) {
        return `<div class="qb qb--error">${esc((e as Error)?.message ?? e)}</div>`;
      }
    },
  },
  callout: {
    type: 'callout',
    label: '提示框',
    container: false,
    defaults: () => ({ title: '提示', text: '内容…', tone: 'info' }),
    render: (p) =>
      `<div class="cs-callout cs-callout--${toneClass(p)}"><div class="cs-callout-title">${esc(p.title || '提示')}</div><div class="cs-callout-text">${esc(p.text || '')}</div></div>`,
  },
  text: {
    type: 'text',
    label: '文本',
    container: false,
    defaults: () => ({ text: '文本内容' }),
    render: (p) => `<div class="cs-text">${esc(p.text || '')}</div>`,
  },
};

/** The single wrapper that carries a node's visual style + box props. */
export function componentNodeOpen(node: ComponentNode): string {
  return `<div class="cs-node cs-node--${node.type}${styleClass(node.props)}"${styleAttr(boxStyle(node.props))}>`;
}

/** Types offered in the add menu (root is NOT directly addable). */
export const ADDABLE_TYPES: ComponentType[] = [
  'stack',
  'grid',
  'tabs',
  'query',
  'callout',
  'text',
];

let idSeq = 0;
export function newId(): string {
  idSeq += 1;
  return `c${Date.now().toString(36)}${idSeq.toString(36)}`;
}

/** Generate a valid, file-safe component ID (`cmp_<base36>_<seq>`). */
export function newComponentId(): string {
  idSeq += 1;
  return `cmp_${Date.now().toString(36)}${idSeq.toString(36)}`;
}

/** An empty document root — no default child, no visible frame. */
export function makeRoot(): ComponentNode {
  return { id: 'root', type: 'root', props: {}, children: [] };
}

export function makeNode(type: ComponentType): ComponentNode {
  const def = COMPONENT_DEFS[type];
  const node: ComponentNode = { id: newId(), type, props: def.defaults() };
  if (def.container) node.children = [];
  return node;
}

/**
 * Parse a ```component fence body: `cmp_<id> [显示名称]`.
 * - empty body            → { kind: 'empty' }
 * - valid id (+ optional name) → { kind: 'id', id, name }
 * - anything that looks like the old inline YAML tree → { kind: 'legacy' }
 */
export function parseComponentFenceRef(src: string): ComponentFenceRef {
  const text = (src || '').trim();
  if (!text) return { kind: 'empty' };
  const firstLine = text.split(/\r?\n/, 1)[0].trim();
  const m = /^(cmp_[a-z0-9_]+)(?:\s+(.*))?$/i.exec(firstLine);
  if (m && isValidComponentId(m[1])) {
    return { kind: 'id', id: m[1], name: (m[2] || '').trim() };
  }
  // Multi-line or YAML-shaped single-line → legacy inline tree.
  if (text.includes('\n') || /^[-[\]{}]/m.test(text) || /(?:^|\n)\s*(type|children|props|id)\s*:/m.test(text)) {
    return { kind: 'legacy' };
  }
  // Not a valid ID and not clearly YAML — still treat as legacy to be safe.
  return { kind: 'legacy' };
}

/** Build the fence body from an ID + optional display name. */
export function serializeComponentFenceRef(id: string, name: string): string {
  if (!isValidComponentId(id)) throw new Error(`Invalid component id: ${id}`);
  const clean = (name || '').replace(/\r?\n/g, ' ').trim();
  return clean ? `${id} ${clean}` : id;
}

/**
 * Parse an external component note: frontmatter `kind/id/name` plus a
 * `component-tree` fence holding the YAML tree. Tolerant of missing fields.
 */
export function parseComponentFile(src: string): ComponentFile | null {
  const text = String(src || '');
  let fm: Record<string, unknown> = {};
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  let body = text;
  if (fmMatch) {
    try {
      const loaded = yaml.load(fmMatch[1]);
      if (loaded && typeof loaded === 'object') fm = loaded as Record<string, unknown>;
    } catch { /* ignore malformed frontmatter */ }
    body = text.slice(fmMatch[0].length);
  }
  const id = String(fm.id || '');
  if (!isValidComponentId(id)) return null;
  const name = String(fm.name || '');
  const fenceRe = new RegExp('```' + COMPONENT_TREE_LANG + '\\s*\\r?\\n([\\s\\S]*?)\\r?\\n```');
  const treeMatch = fenceRe.exec(body);
  const tree = treeMatch ? parseComponentTree(treeMatch[1]) : makeRoot();
  return { id, name, tree };
}

/** Serialize a component tree to a plain markdown note with frontmatter. */
export function serializeComponentFile(file: ComponentFile): string {
  if (!isValidComponentId(file.id)) throw new Error(`Invalid component id: ${file.id}`);
  const fm = yaml.dump({ kind: 'component', id: file.id, name: file.name || '' }, { lineWidth: 120 }).trimEnd();
  const treeYaml = serializeComponentTree(file.tree);
  return `---\n${fm}\n---\n\n\`\`\`${COMPONENT_TREE_LANG}\n${treeYaml}\n\`\`\`\n`;
}

/** Parse a ```component fence body. Tolerant: bad YAML → empty root. */
export function parseComponentTree(src: string): ComponentNode {
  let raw: unknown;
  try {
    raw = yaml.load(src);
  } catch {
    return makeRoot();
  }
  const walk = (value: unknown, depth: number): ComponentNode | null => {
    if (!value || typeof value !== 'object' || depth > 6) return null;
    const o = value as Record<string, unknown>;
    const type = String(o.type || '') as ComponentType;
    if (!Object.prototype.hasOwnProperty.call(COMPONENT_DEFS, type)) return null;
    const def = COMPONENT_DEFS[type];
    const props =
      o.props && typeof o.props === 'object' ? (o.props as Record<string, unknown>) : def.defaults();
    const node: ComponentNode = {
      id: typeof o.id === 'string' && o.id ? o.id : newId(),
      type,
      props: { ...def.defaults(), ...props },
    };
    if (def.container) {
      node.children = Array.isArray(o.children)
        ? (o.children as unknown[]).map((c) => walk(c, depth + 1)).filter((c): c is ComponentNode => !!c)
        : [];
    }
    return node;
  };
  // Accept both a single root node and a bare children array.
  if (Array.isArray(raw)) {
    const root = makeRoot();
    root.children = raw.map((c) => walk(c, 1)).filter((c): c is ComponentNode => !!c);
    return root;
  }
  return walk(raw, 0) ?? makeRoot();
}

/** Serialize a tree to the fence body. A bare children array keeps the empty
 *  document indistinguishable from "no components yet" (fully blank). */
export function serializeComponentTree(root: ComponentNode): string {
  const clean = (node: ComponentNode): Record<string, unknown> => {
    const def = COMPONENT_DEFS[node.type];
    const out: Record<string, unknown> = { id: node.id, type: node.type, props: node.props };
    if (def.container) out.children = (node.children ?? []).map(clean);
    return out;
  };
  if (root.type === 'root') {
    return yaml.dump((root.children ?? []).map(clean), { lineWidth: 120, noRefs: true }).trimEnd();
  }
  return yaml.dump(clean(root), { lineWidth: 120, noRefs: true }).trimEnd();
}

/** Pure render for Preview / plain-text editor / widget internals. */
export function renderComponentTree(root: ComponentNode): string {
  const render = (node: ComponentNode): string => {
    const def = COMPONENT_DEFS[node.type];
    const children = (node.children ?? []).map(render).join('');
    const inner = def.render(node.props, children);
    if (node.type === 'root') return inner; // transparent root, no wrapper
    return componentNodeOpen(node) + inner + '</div>';
  };
  return `<div class="cs-root" data-component-root="1">${render(root)}</div>`;
}

/** Find a node by id, returning its parent + index for structural edits. */
export function findNode(
  root: ComponentNode,
  id: string,
): { node: ComponentNode; parent: ComponentNode | null; index: number } | null {
  if (root.id === id) return { node: root, parent: null, index: 0 };
  const walk = (parent: ComponentNode): ReturnType<typeof findNode> => {
    const children = parent.children ?? [];
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (child.id === id) return { node: child, parent, index: i };
      if (COMPONENT_DEFS[child.type].container) {
        const found = walk(child);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(root);
}
