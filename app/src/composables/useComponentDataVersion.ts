import { onBeforeUnmount, ref, type Ref } from 'vue';
import { getComponentDataVersion, onComponentDataChange } from '../lib/component-system';

/**
 * `componentDataVersion()` as a ref. Preview re-runs processQuery() when a
 * component note is saved / reloaded so a freshly-loading component no longer
 * stays stuck on "未找到" until a full page reload (the CM widget side already
 * rebuilds on this signal via ComponentWidget.eq()).
 */
export function useComponentDataVersion(): Ref<number> {
  const version = ref(getComponentDataVersion());
  const off = onComponentDataChange(() => {
    version.value = getComponentDataVersion();
  });
  onBeforeUnmount(off);
  return version;
}
