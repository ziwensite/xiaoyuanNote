import assert from 'node:assert/strict';
import test from 'node:test';

import { createEntryWriter, upsertEntryLine, type EntryWriterDeps } from './entry-writer';

// P3: where a new entry lands. The pure half is about the text; the writer half
// is about not writing twice and not losing what someone else wrote.

const OPTS = { uid: 't001', heading: '## 任务' };
const LINE = '- [ ] 写周报 🆔 t001 📅 2026-11-12 ⏫';

const DOC = [
  '# 2026-11-10',
  '',
  '## 任务',
  '- [ ] 手写的一行 📅 2026-11-09',
  '',
  '## 笔记',
  '随手记',
].join('\n');

test('a new line is inserted directly under the capture heading', () => {
  const result = upsertEntryLine(DOC, LINE, OPTS);
  assert.equal(result.changed, true);
  assert.deepEqual(result.text.split('\n').slice(2, 6), [
    '## 任务',
    LINE,
    '- [ ] 手写的一行 📅 2026-11-09',
    '',
  ]);
});

test('without the heading the line goes after the last non-empty line', () => {
  const noHeading = ['# 2026-11-10', '', '正文结束'].join('\n');
  const result = upsertEntryLine(noHeading, LINE, OPTS);
  assert.equal(result.text, ['# 2026-11-10', '', '正文结束', LINE].join('\n'));
});

test('an empty heading setting means the same thing', () => {
  const result = upsertEntryLine('正文\n\n\n', LINE, { uid: 't001', heading: '  ' });
  assert.equal(result.text, `正文\n${LINE}\n\n\n`);
});

test('an existing uid is updated where it already sits', () => {
  const doc = [
    '## 任务',
    '- [ ] 旧的写法 🆔 t001 📅 2026-11-12',
    '- [ ] 别人的事 📅 2026-11-13',
    '',
    '尾部',
  ].join('\n');
  const result = upsertEntryLine(doc, LINE, OPTS);
  assert.equal(result.changed, true);
  assert.deepEqual(result.text.split('\n'), [
    '## 任务',
    LINE,
    '- [ ] 别人的事 📅 2026-11-13',
    '',
    '尾部',
  ]);
});

test('writing the same line again changes nothing at all', () => {
  const once = upsertEntryLine(DOC, LINE, OPTS);
  const twice = upsertEntryLine(once.text, LINE, OPTS);
  assert.equal(twice.changed, false);
  assert.equal(twice.text, once.text);
});

test('the line keeps the file\'s CRLF endings', () => {
  const crlf = ['# 2026-11-10', '', '## 任务', ''].join('\r\n');
  const result = upsertEntryLine(crlf, LINE, OPTS);
  assert.equal(result.text, `${['# 2026-11-10', '', '## 任务', LINE, ''].join('\r\n')}`);
  assert.equal(result.text.includes('\n\n'), false, 'no bare LF introduced');
});

test('a line without a uid is always inserted, never merged into a lookalike', () => {
  const entry = '- [ ] 咖啡 📅 2026-11-12';
  const once = upsertEntryLine(DOC, entry, { uid: '', heading: '## 任务' });
  const twice = upsertEntryLine(once.text, entry, { uid: '', heading: '## 任务' });
  assert.equal(once.changed, true);
  assert.equal(twice.changed, true);
  assert.equal(twice.text.split(entry).length - 1, 2, 'both copies are there');
});

test('lines the user wrote by hand are left exactly where they were', () => {
  const result = upsertEntryLine(DOC, LINE, OPTS);
  const before = DOC.split('\n').filter((l) => l !== '');
  const after = result.text.split('\n').filter((l) => l !== '');
  assert.deepEqual(after.filter((l) => l !== LINE), before);
});

// ---------------------------------------------------------------------------
// createEntryWriter — queueing and conflict handling
// ---------------------------------------------------------------------------

interface FakeVfs {
  files: Map<string, string>;
  writes: string[];
  deps: EntryWriterDeps;
}

function memoryVfs(initial: Record<string, string> = {}): FakeVfs {
  const files = new Map(Object.entries(initial));
  const writes: string[] = [];
  return {
    files,
    writes,
    deps: {
      read: async (path) => (files.has(path) ? files.get(path)! : null),
      write: async (path, text) => {
        files.set(path, text);
        writes.push(path);
      },
    },
  };
}

const PATH = '/ws/Daily/2026-11-10.md';

test('a missing file is created with the line in it', async () => {
  const vfs = memoryVfs();
  const write = createEntryWriter(vfs.deps);
  assert.equal(await write(PATH, LINE, OPTS), 'created');
  assert.equal(vfs.files.get(PATH)!.split('\n').filter((l) => l.includes('🆔 t001')).length, 1);
});

test('running the same write three times leaves one line and one real write', async () => {
  const vfs = memoryVfs({ [PATH]: DOC });
  const write = createEntryWriter(vfs.deps);
  assert.equal(await write(PATH, LINE, OPTS), 'written');
  assert.equal(await write(PATH, LINE, OPTS), 'unchanged');
  assert.equal(await write(PATH, LINE, OPTS), 'unchanged');
  assert.equal(vfs.writes.length, 1);
  assert.equal(vfs.files.get(PATH)!.split(LINE).length - 1, 1);
});

test('two writes racing on one path are serialized, so only one lands', async () => {
  const vfs = memoryVfs({ [PATH]: DOC });
  const write = createEntryWriter(vfs.deps);
  const outcomes = await Promise.all([write(PATH, LINE, OPTS), write(PATH, LINE, OPTS)]);
  assert.deepEqual(outcomes, ['written', 'unchanged']);
  assert.equal(vfs.writes.length, 1);
  assert.equal(vfs.files.get(PATH)!.split(LINE).length - 1, 1);
});

test('different entries racing both land', async () => {
  const vfs = memoryVfs({ [PATH]: DOC });
  const write = createEntryWriter(vfs.deps);
  const other = '- [ ] 采购硬件 🆔 t002 📅 2026-11-13';
  await Promise.all([
    write(PATH, LINE, OPTS),
    write(PATH, other, { uid: 't002', heading: '## 任务' }),
  ]);
  const text = vfs.files.get(PATH)!;
  assert.equal(text.split(LINE).length - 1, 1);
  assert.equal(text.split(other).length - 1, 1);
});

test('a file that changed while we were computing is re-read, not clobbered', async () => {
  // First read sees the old text, the second (just before writing) sees the
  // text another writer produced, so the plan is recomputed on top of it.
  const seen = [`# 旧\n`, DOC];
  let reads = 0;
  const files = new Map<string, string>();
  const deps: EntryWriterDeps = {
    read: async () => {
      const value = seen[Math.min(reads, seen.length - 1)];
      reads += 1;
      return value;
    },
    write: async (path, text) => {
      files.set(path, text);
    },
  };
  const write = createEntryWriter(deps);
  assert.equal(await write(PATH, LINE, OPTS), 'written');
  assert.ok(files.get(PATH)!.includes('手写的一行'), 'the other writer\'s line survived');
  assert.ok(files.get(PATH)!.includes(LINE));
});
