import assert from 'node:assert/strict';
import test from 'node:test';

const { createPinia, setActivePinia } = await import('pinia');
const { useCaptureDialogStore } = await import('./capture-dialog');
const { newCapturePreset } = await import('../lib/capture');

function fresh() {
  setActivePinia(createPinia());
  return useCaptureDialogStore();
}

test('capture dialog resolves the submitted value and clears the request', async () => {
  const dialog = fresh();
  const preset = newCapturePreset('p', 'Preset');
  const pending = dialog.open({ preset, placeholder: 'Value' });
  assert.ok(dialog.request);
  dialog.submit('hello');
  assert.equal(await pending, 'hello');
  assert.equal(dialog.request, null);
});

test('capture dialog resolves null on cancel and can reopen afterwards', async () => {
  const dialog = fresh();
  const preset = newCapturePreset('p', 'Preset');
  const first = dialog.open({ preset });
  dialog.cancel();
  assert.equal(await first, null);

  const second = dialog.open({ preset });
  dialog.submit('second');
  assert.equal(await second, 'second');
});
