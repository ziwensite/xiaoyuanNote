import assert from 'node:assert/strict';
import test from 'node:test';

import { captureInputKeyAction, type CaptureInputKeyEvent } from './capture-input';

const key = (value: string, extra: Partial<CaptureInputKeyEvent> = {}): CaptureInputKeyEvent => ({
  key: value,
  ...extra,
});

test('single-line capture submits on Enter and keeps Shift+Enter as a newline', () => {
  assert.equal(captureInputKeyAction('single-line', key('Enter')), 'submit');
  assert.equal(captureInputKeyAction('single-line', key('Enter', { shiftKey: true })), 'newline');
  assert.equal(captureInputKeyAction('single-line', key('a')), 'ignore');
  assert.equal(captureInputKeyAction('none', key('Enter')), 'submit');
});

test('multi-line capture uses Ctrl/Cmd+Enter to submit', () => {
  assert.equal(captureInputKeyAction('multi-line', key('Enter')), 'newline');
  assert.equal(captureInputKeyAction('multi-line', key('Enter', { ctrlKey: true })), 'submit');
  assert.equal(captureInputKeyAction('multi-line', key('Enter', { metaKey: true })), 'submit');
  assert.equal(captureInputKeyAction('multi-line', key('Enter', { shiftKey: true })), 'newline');
});

test('IME composition and Escape are handled before input-method rules', () => {
  assert.equal(captureInputKeyAction('single-line', key('Enter', { isComposing: true })), 'ignore');
  assert.equal(captureInputKeyAction('single-line', key('Enter', { keyCode: 229 })), 'ignore');
  assert.equal(captureInputKeyAction('single-line', key('Enter'), true), 'ignore');
  assert.equal(captureInputKeyAction('multi-line', key('Escape')), 'cancel');
});
