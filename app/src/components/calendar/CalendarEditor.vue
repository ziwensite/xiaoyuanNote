<script setup lang="ts">
/**
 * Event composer shared by the month split and the floating day/week panel.
 *
 * Fields mutate the draft object in place; the workspace owns the draft and
 * decides when it is saved. Date/time inputs are disabled when the edit targets
 * the whole series, because those fields belong to the master's DTSTART — the
 * hint explains that.
 *
 * Reminders are edited as trigger strings (`-PT15M`, `09:00`, absolute ISO).
 * The draft keeps the full `{trigger, action}` pair so an imported non-DISPLAY
 * alarm survives an unrelated edit, and invalid triggers are refused here
 * rather than saved into an alarm that can never fire.
 */
import { computed, ref } from 'vue';
import { useI18n } from '../../i18n';
import { isValidAlarmTrigger } from '../../lib/calendar-reminders';
import type { EditorDraft } from './editor-draft';

const props = defineProps<{
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

interface AlarmPreset {
  value: string;
  label: string;
}

/** Presets cover the common cases; anything else goes through "custom". */
const alarmPresets = computed<AlarmPreset[]>(() => [
  { value: '-PT5M', label: t('calendar.editor.beforeMinute', { n: 5 }) },
  { value: '-PT10M', label: t('calendar.editor.beforeMinute', { n: 10 }) },
  { value: '-PT15M', label: t('calendar.editor.beforeMinute', { n: 15 }) },
  { value: '-PT30M', label: t('calendar.editor.beforeMinute', { n: 30 }) },
  { value: '-PT1H', label: t('calendar.editor.beforeHour', { n: 1 }) },
  { value: '-P1D', label: t('calendar.editor.beforeDay', { n: 1 }) },
  { value: '09:00', label: t('calendar.editor.alarmsOnDayAt', { time: '09:00' }) },
]);

const customOpen = ref(false);
const customTrigger = ref('');
const alarmError = ref('');

function alarmLabel(trigger: string): string {
  return alarmPresets.value.find((p) => p.value === trigger)?.label ?? trigger;
}

function addAlarm(trigger: string): boolean {
  const value = trigger.trim();
  if (!isValidAlarmTrigger(value)) {
    alarmError.value = t('calendar.editor.alarmsInvalid');
    return false;
  }
  alarmError.value = '';
  if (!props.draft.alarms.some((a) => a.trigger === value)) {
    props.draft.alarms.push({ trigger: value, action: 'DISPLAY' });
  }
  customOpen.value = false;
  customTrigger.value = '';
  return true;
}

function onPresetChange(event: Event) {
  const el = event.target as HTMLSelectElement;
  const value = el.value;
  // Snap back to the placeholder so picking the same preset twice still fires.
  el.value = '';
  if (!value) return;
  if (value === '__custom') {
    customOpen.value = true;
    return;
  }
  addAlarm(value);
}

function confirmCustomAlarm() {
  addAlarm(customTrigger.value);
}

function removeAlarm(index: number) {
  props.draft.alarms.splice(index, 1);
  alarmError.value = '';
}
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

    <div
      v-if="draft.recurring"
      class="cal-editor__scope"
      role="radiogroup"
      :aria-label="t('calendar.editor.scopeLabel')"
    >
      <label class="cal-editor__check">
        <input v-model="draft.scope" type="radio" value="single">
        <span>{{ t('calendar.editor.scopeSingle') }}</span>
      </label>
      <label class="cal-editor__check">
        <input v-model="draft.scope" type="radio" value="series">
        <span>{{ t('calendar.editor.scopeSeries') }}</span>
      </label>
      <label class="cal-editor__check">
        <input v-model="draft.scope" type="radio" value="after">
        <span>{{ t('calendar.editor.scopeAfter') }}</span>
      </label>
    </div>

    <div class="cal-editor__row">
      <label class="cal-editor__field cal-editor__field--date">
        <span>{{ t('calendar.editor.date') }}</span>
        <input v-model="draft.date" type="date" class="cal-editor__input" :disabled="draft.recurring && draft.scope === 'series'">
      </label>
      <label class="cal-editor__check">
        <input v-model="draft.allDay" type="checkbox" :disabled="draft.recurring && draft.scope === 'series'">
        <span>{{ t('calendar.editor.allDay') }}</span>
      </label>
    </div>

    <div v-if="!draft.allDay" class="cal-editor__row">
      <label class="cal-editor__field">
        <span>{{ t('calendar.editor.start') }}</span>
        <input v-model="draft.start" type="time" step="900" class="cal-editor__input" :disabled="draft.recurring && draft.scope === 'series'">
      </label>
      <label class="cal-editor__field">
        <span>{{ t('calendar.editor.end') }}</span>
        <input v-model="draft.end" type="time" step="900" class="cal-editor__input" :disabled="draft.recurring && draft.scope === 'series'">
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

    <div class="cal-editor__field">
      <span>{{ t('calendar.editor.alarms') }}</span>
      <ul v-if="draft.alarms.length" class="cal-editor__alarms">
        <li v-for="(alarm, index) in draft.alarms" :key="`${alarm.trigger}-${index}`" class="cal-editor__alarm">
          <span class="cal-editor__alarm-label">{{ alarmLabel(alarm.trigger) }}</span>
          <button
            type="button"
            class="cal-editor__alarm-remove"
            :aria-label="t('calendar.editor.alarmsRemove')"
            @click="removeAlarm(index)"
          >
            ×
          </button>
        </li>
      </ul>
      <select class="cal-editor__input" value="" @change="onPresetChange">
        <option value="">
          {{ draft.alarms.length ? t('calendar.editor.alarmsAdd') : t('calendar.editor.alarmsNone') }}
        </option>
        <option v-for="preset in alarmPresets" :key="preset.value" :value="preset.value">
          {{ preset.label }}
        </option>
        <option value="__custom">{{ t('calendar.editor.alarmsCustom') }}</option>
      </select>
      <div v-if="customOpen" class="cal-editor__alarm-custom">
        <input
          v-model="customTrigger"
          type="text"
          class="cal-editor__input"
          :placeholder="t('calendar.editor.alarmsCustomPlaceholder')"
          @keydown.enter.prevent="confirmCustomAlarm"
        >
        <button type="button" class="cal-editor__btn" @click="confirmCustomAlarm">
          {{ t('calendar.editor.alarmsAddConfirm') }}
        </button>
      </div>
      <p v-if="alarmError" class="cal-editor__error">{{ alarmError }}</p>
    </div>

    <p v-if="draft.recurring && draft.scope === 'series'" class="cal-editor__hint">
      {{ t('calendar.editor.recurringHint') }}
    </p>
    <p v-if="draft.recurring && draft.scope === 'single'" class="cal-editor__hint">
      {{ t('calendar.editor.singleHint') }}
    </p>
    <p v-if="draft.recurring && draft.scope === 'after'" class="cal-editor__hint">
      {{ t('calendar.editor.afterHint') }}
    </p>
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

.cal-editor__scope {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  padding: 8px 10px;
  border: var(--bd-hair);
  border-radius: var(--r-sm);
  background: var(--bg-1);
}

.cal-editor__scope .cal-editor__check {
  padding-bottom: 0;
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

.cal-editor__alarms {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 0 4px;
  padding: 0;
  list-style: none;
}

.cal-editor__alarm {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px 2px 8px;
  border: var(--bd-hair);
  border-radius: var(--r-sm);
  background: var(--bg-1);
  font-size: 12px;
  color: var(--text);
}

.cal-editor__alarm-remove {
  border: 0;
  background: transparent;
  padding: 0 4px;
  font-size: 14px;
  line-height: 1;
  color: var(--text-3);
  cursor: pointer;
}

.cal-editor__alarm-remove:hover {
  color: var(--danger, #d33);
}

.cal-editor__alarm-custom {
  display: flex;
  gap: 6px;
  margin-top: 6px;
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
