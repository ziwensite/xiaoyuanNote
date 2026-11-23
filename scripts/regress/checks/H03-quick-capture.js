// id: H3
// title: quick capture writes the captured text into the vault inbox (backend of the capture box)
const R = checks();
await inv('capture_set_workspace', { folder: VAULT });
const marker = 'qc-' + Date.now();
const path = `inbox/${marker}.md`;
const content = `---\ntitle: ${marker}\ninbox: true\n---\n\n${marker} captured text\n`;
let res = '';
try {
  res = await inv('capture_write_rendered', { path, content, dedupe: true, emit: false });
} catch (e) {
  R.t(false, 'capture_write_rendered failed: ' + e);
  return R.done();
}
R.t(typeof res === 'string' && res.startsWith(VAULT), 'written inside the fixture vault: ' + res);
const txt = await inv('read_file', { path: res }).then((r) => r.content).catch(() => '');
R.t(txt.includes(marker) && /inbox:\s*true/.test(txt), 'file has the text and inbox: true');
return R.done();
