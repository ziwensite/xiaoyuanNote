<script setup lang="ts">
/**
 * Event composer shared by the month split and the floating day/week panel.
 *
 * Fields mutate the draft object in place; the workspace owns the draft and
 * decides when it is saved. Date/time inputs are disabled for repeating events
 * because M2 does not edit recurrence — the hint explains that.
 */
import { useI18n } from '../../i18n';
import type { EditorDraft } from './editor-draft';

defineProps<{
  draft: EditorDraft;
  saving: boolean;
  error: string;
}>();

const emit = defineEmits<{
  save: [];
  cancel: [];
  toggleStatus: [];
  openNote: [path: string];
}>();

const { t } = useI18n();
</script>

<template>
  <form class="cal-editor" @submit.prevent="emit('save')">
    <header class="cal-editor__head">
      <h3>{{ draft.mode === 'new' ? t('calendar.editor.newTitle') : t('calendar.editor.editTitle') }}</h3>
      <button
        v-if="draft.mode === 'edit' && draft.path"
        type="button"
        class="cal-editor__link"
        @click="emit('openNote', draft.path)"
      >
        {{ t('calendar.editor.openNote') }}
      </button>
    </header>

    <label class="cal-editor__field">
      <span>{{ t('calendar.editor.title') }}</span>
      <input
        v-model="draft.title"
        type="text"
        class="cal-editor__input"
        :placeholder="t('calendar.editor.untitled')"
        autofocus
      >
    </label>

    <div class="cal-editor__row">
      <label class="cal-editor__field cal-editor__field--date">
        <span>{{ t('calendar.editor.date') }}</span>
        <input v-model="draft.date" type="date" class="cal-editor__input" :disabled="draft.recurring">
      </label>
      <label class="cal-editor__check">
        <input v-model="draft.allDay" type="checkbox" :disabled="draft.recurring">
        <span>{{ t('calendar.editor.allDay') }}</span>
      </label>
    </div>

    <div v-if="!draft.allDay" class="cal-editor__row">
      <label class="cal-editor__field">
        <span>{{ t('calendar.editor.start') }}</span>
        <input v-model="draft.start" type="time" step="900" class="cal-editor__input" :disabled="draft.recurring">
      </label>
      <label class="cal-editor__field">
        <span>{{ t('calendar.editor.end') }}</span>
        <input v-model="draft.end" type="time" step="900" class="cal-editor__input" :disabled="draft.recurring">
      </label>
    </div>

    <label class="cal-editor__field">
      <span>{{ t('calendar.editor.location') }}</span>
      <input v-model="draft.location" type="text" class="cal-editor__input">
    </label>

    <label class="cal-editor__field cal-editor__field--grow">
      <span>{{ t('calendar.editor.notes') }}</span>
      <textarea v-model="draft.notes" class="cal-editor__input cal-editor__notes" rows="4" />
    </label>

    <p v-if="draft.recurring" class="cal-editor__hint">{{ t('calendar.editor.recurringHint') }}</p>
    <p v-if="draft.ruleUnsupported.length" class="cal-editor__warning">
      {{ t('calendar.editor.ruleWarning', { parts: draft.ruleUnsupported.join(', ') }) }}
    </p>
    <p v-if="error" class="cal-editor__error">{{ error }}</p>

    <footer class="cal-editor__actions">
      <button
        v-if="draft.mode === 'edit'"
        type="button"
        class="cal-editor__btn cal-editor__btn--danger"
        @click="emit('toggleStatus')"
      >
        {{ draft.status === 'CANCELLED' ? t('calendar.editor.restore') : t('calendar.editor.delete') }}
      </button>
      <span class="cal-editor__spacer" />
      <button type="button" class="cal-editor__btn" @click="emit('cancel')">
        {{ t('calendar.cancel') }}
      </button>
      <button type="submit" class="cal-editor__btn cal-editor__btn--primary" :disabled="saving">
        {{ t('calendar.editor.save') }}
      </button>
    </footer>
  </form>
</template>

<style scoped>
.cal-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  min-height: 0;
  padding: 14px 16px;
  overflow-y: auto;
  background: var(--bg-pop);
}

.cal-editor__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.cal-editor__head h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.cal-editor__link {
  border: 0;
  background: transparent;
  padding: 0;
  font-size: 12px;
  color: var(--accent);
  cursor: pointer;
}

.cal-editor__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-2);
}

.cal-editor__field--grow {
  flex: 1;
  min-height: 90px;
}

.cal-editor__field--date {
  flex: 1;
}

.cal-editor__row {
  display: flex;
  gap: 10px;
  align-items: flex-end;
}

.cal-editor__check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-2);
  padding-bottom: 8px;
}

.cal-editor__input {
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  font-size: 13px;
  padding: 6px 8px;
  border: var(--bd-hair);
  border-radius: var(--r-sm);
  background: var(--bg-1);
  color: var(--text);
}

.cal-editor__notes {
  flex: 1;
  resize: vertical;
  min-height: 80px;
}

.cal-editor__hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-3);
}

.cal-editor__error {
  margin: 0;
  font-size: 12px;
  color: var(--danger, #d33);
}

.cal-editor__warning {
  margin: 0;
  font-size: 12px;
  color: var(--warning, #b7791f);
}

.cal-editor__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 4px;
}

.cal-editor__spacer {
  flex: 1;
}

.cal-editor__btn {
  padding: 6px 12px;
  font-size: 12px;
  border: var(--bd-hair);
  border-radius: var(--r-sm);
  background: var(--fill-1);
  color: var(--text);
  cursor: pointer;
}

.cal-editor__btn--primary {
  background: var(--accent);
  color: #fff;
  border-color: transparent;
}

.cal-editor__btn--danger {
  color: var(--danger, #d33);
}

.cal-editor__btn:disabled {
  opacity: 0.55;
  cursor: default;
}
</style>
