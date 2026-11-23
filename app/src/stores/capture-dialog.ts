import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { CapturePreset } from '../lib/capture';

export interface CaptureDialogRequest {
  preset: CapturePreset;
  initialValue?: string;
  placeholder?: string;
}

/**
 * Promise-based bridge between `useCapture` and the modal rendered in App.vue.
 * A composable cannot mount a dialog itself; this store lets it await the
 * value the same way it used to await `window.prompt`.
 */
export const useCaptureDialogStore = defineStore('captureDialog', () => {
  const request = ref<CaptureDialogRequest | null>(null);
  let resolver: ((value: string | null) => void) | null = null;

  function settle(value: string | null) {
    const resolve = resolver;
    resolver = null;
    request.value = null;
    resolve?.(value);
  }

  function open(req: CaptureDialogRequest): Promise<string | null> {
    if (resolver) settle(null);
    request.value = req;
    return new Promise<string | null>((resolve) => {
      resolver = resolve;
    });
  }

  function submit(value: string) {
    settle(value);
  }

  function cancel() {
    settle(null);
  }

  return { request, open, submit, cancel };
});
