import type { CaptureInputMethod } from './capture';

export type CaptureInputKeyAction = 'submit' | 'newline' | 'cancel' | 'ignore';

export interface CaptureInputKeyEvent {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}

/**
 * One keyboard policy for every capture textbox: the global quick-capture
 * window and the in-app capture prompt. IME composition and Escape are handled
 * before the input-method rules, so confirming a pinyin/kana candidate with
 * Enter can never file a half-typed note.
 */
export function captureInputKeyAction(
  inputMethod: CaptureInputMethod,
  event: CaptureInputKeyEvent,
  composing = false,
): CaptureInputKeyAction {
  if (event.key === 'Escape') return 'cancel';
  if (event.key !== 'Enter') return 'ignore';
  if (composing || event.isComposing || event.keyCode === 229) return 'ignore';
  if (inputMethod === 'multi-line') {
    return event.ctrlKey || event.metaKey ? 'submit' : 'newline';
  }
  return event.shiftKey ? 'newline' : 'submit';
}
