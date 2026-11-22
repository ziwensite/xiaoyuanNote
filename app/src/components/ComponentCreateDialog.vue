<script setup lang="ts">
/**
 * Insert-component dialog — new / import / copy.
 *
 * Replaces the old `window.prompt` flow. "Import" inserts a fence that
 * references an existing component note (same id + name, no new file).
 * "Copy" creates a brand-new note with a fresh id and an editable name,
 * seeded from the chosen component's tree. All three paths finish by
 * dispatching the shared `xiaoyuan-note:insert-query-block` event.
 */
import { computed, ref, watch } from 'vue';
import { DsButton, DsInput, DsModal, DsSelect, type DsSelectOption } from '../ui';
import { useI18n } from '../i18n';
import { serializeComponentFenceRef } from '../lib/component-system';
import { useComponentsStore } from '../stores/components';
import { useToastsStore } from '../stores/toasts';

type Mode = 'new' | 'import' | 'copy';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const { t } = useI18n();
const components = useComponentsStore();
const toasts = useToastsStore();

const modes: Mode[] = ['new', 'import', 'copy'];
const mode = ref<Mode>('new');
const name = ref('');
const selectedId = ref('');
const busy = ref(false);

const options = computed<DsSelectOption[]>(() =>
  components.list.map((c) => ({ value: c.id, label: c.name || c.id })),
);
const source = computed(() => components.get(selectedId.value));
const canConfirm = computed(
  () =>
    !busy.value &&
    (mode.value === 'new' || !!source.value) &&
    (mode.value !== 'copy' || !!name.value.trim()),
);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    mode.value = 'new';
    name.value = t('componentDialog.defaultName');
    selectedId.value = components.list[0]?.id ?? '';
    busy.value = false;
  },
);

watch(selectedId, () => {
  if (mode.value === 'copy') {
    name.value = `${source.value?.name || ''}${t('componentDialog.copySuffix')}`;
  }
});

function pickMode(next: Mode) {
  mode.value = next;
  if (next === 'copy') {
    name.value = `${source.value?.name || ''}${t('componentDialog.copySuffix')}`;
  }
}

function insertFence(id: string) {
  // The fence stores only the ID; the name lives in the component note.
  const fence = '```component\n' + serializeComponentFenceRef(id, '') + '\n```';
  window.dispatchEvent(new CustomEvent('xiaoyuan-note:insert-query-block', { detail: { fence } }));
}

async function confirm() {
  if (!canConfirm.value) return;
  if (!components.folder) {
    toasts.error(t('componentDialog.noWorkspace'));
    return;
  }
  busy.value = true;
  try {
    if (mode.value === 'new') {
      const finalName = name.value.trim() || t('componentDialog.defaultName');
      const id = await components.create(finalName);
      insertFence(id);
    } else if (mode.value === 'import') {
      insertFence(source.value!.id);
    } else {
      const src = source.value!;
      const finalName =
        name.value.trim() || `${src.name}${t('componentDialog.copySuffix')}`;
      const id = await components.create(finalName, src.tree);
      insertFence(id);
    }
    emit('close');
  } catch (e) {
    toasts.error(t('componentDialog.failed', { error: String(e) }));
  } finally {
    busy.value = false;
  }
}

function cancel() {
  emit('close');
}
</script>

<template>
  <DsModal
    :model-value="open"
    :title="t('componentDialog.title')"
    width="460px"
    @update:model-value="(v) => !v && cancel()"
  >
    <div class="cmp-dialog">
      <div class="cmp-dialog__modes" role="group" :aria-label="t('componentDialog.title')">
        <DsButton
          v-for="m in modes"
          :key="m"
          class="cmp-dialog__mode"
          :variant="mode === m ? 'primary' : 'secondary'"
          size="sm"
          @click="pickMode(m)"
        >{{ t('componentDialog.mode.' + m) }}</DsButton>
      </div>
      <p class="cmp-dialog__hint">{{ t('componentDialog.hint.' + mode) }}</p>

      <template v-if="mode === 'new'">
        <label class="cmp-dialog__label">{{ t('componentDialog.nameLabel') }}</label>
        <DsInput
          v-model="name"
          :placeholder="t('componentDialog.namePlaceholder')"
          @keydown.enter.prevent="confirm"
        />
      </template>

      <template v-else>
        <label class="cmp-dialog__label">{{ t('componentDialog.sourceLabel') }}</label>
        <DsSelect v-if="source || options.length" v-model="selectedId" :options="options" />
        <p v-else class="cmp-dialog__empty">{{ t('componentDialog.noComponents') }}</p>

        <template v-if="mode === 'copy'">
          <label class="cmp-dialog__label">{{ t('componentDialog.nameLabel') }}</label>
          <DsInput
            v-model="name"
            :placeholder="t('componentDialog.namePlaceholder')"
            @keydown.enter.prevent="confirm"
          />
        </template>
      </template>
    </div>

    <template #footer>
      <DsButton variant="secondary" @click="cancel">{{ t('componentDialog.cancel') }}</DsButton>
      <DsButton variant="primary" :disabled="!canConfirm" :loading="busy" @click="confirm">
        {{ t('componentDialog.insert') }}
      </DsButton>
    </template>
  </DsModal>
</template>

<style scoped>
.cmp-dialog {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.cmp-dialog__modes {
  display: flex;
  gap: 8px;
}
.cmp-dialog__mode {
  flex: 1;
}
.cmp-dialog__hint {
  margin: 0;
  color: var(--text-3);
  font-size: 12px;
  line-height: 1.5;
}
.cmp-dialog__label {
  color: var(--text-2);
  font-size: 12px;
}
.cmp-dialog__empty {
  margin: 0;
  padding: 12px;
  border: var(--bd-hair);
  border-radius: var(--r-md);
  color: var(--text-3);
  font-size: 12px;
}
</style>
