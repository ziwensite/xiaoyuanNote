<script setup lang="ts">
/**
 * Batch 7 — the task editor, reached from the last row of every space-menu
 * level.
 *
 * It edits one task line as a whole: status, description, tags, 🆔, ⛔, 🔁, the
 * six date fields, priority. Everything is a plain form value; nothing touches
 * the document until Save, which re-serializes the line through `task-line.ts`
 * (canonical order, one space between tokens) in a single transaction.
 *
 * The preview at the bottom is exactly what Save will write, so the rewrite is
 * never a surprise. `open` (indentation, quote markers, bullet) comes from the
 * original line and is not editable; unrecognised fragments are carried over
 * untouched at the end.
 *
 * Labels live here rather than in the locale files: like the menu, this is a
 * zh/en pair and adding keys to fourteen locales is not worth it for a dialog
 * whose only content is task syntax.
 */
import { computed, reactive, ref, watch } from 'vue';
import { DsButton, DsModal, DsInput, DsSelect, type DsSelectOption } from '../ui';
import DatePickerPopover from './DatePickerPopover.vue';
import Icons from './Icons.vue';
import { compileNaturalRecurrence } from '../lib/tasks';
import {
  TASK_DATE_FIELDS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  linkTaskDates,
  serializeTaskLine,
  type TaskLineModel,
} from '../lib/task-line';

const props = defineProps<{
  open: boolean;
  model: TaskLineModel | null;
  /** UI language; anything starting with `zh` gets Chinese. */
  lang: string;
  /** Today as `YYYY-MM-DD`, for the status ↔ `✅`/`❌` link. */
  today: string;
  /**
   * Batch 9 — the field the menu's `🆔` / `⛔` rows want focused when the
   * dialog opens. DsModal honours `data-autofocus`, so this only picks which
   * input carries it; every other way into the dialog focuses the first field.
   */
  focus?: 'id' | 'blockedBy' | null;
}>();

const emit = defineEmits<{ save: [TaskLineModel]; cancel: [] }>();

const isZh = () => props.lang.toLowerCase().startsWith('zh');
const pick = (zh: string, en: string) => (isZh() ? zh : en);

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/u;

const form = reactive({
  status: ' ',
  description: '',
  tags: '',
  id: '',
  blockedBy: '',
  recurrence: '',
  created: '',
  start: '',
  scheduled: '',
  due: '',
  priority: '',
  cancelled: '',
  completed: '',
});

/** The parts the form must not invent: line prefix, reminders, leftovers. */
const base = ref<{ open: string; reminders: string[]; extra: string[] }>({
  open: '- [',
  reminders: [],
  extra: [],
});

function reset(model: TaskLineModel | null): void {
  base.value = {
    open: model?.open ?? '- [',
    // No field for `⏰` here, but it is a token now: carrying it through the
    // form is what stops the preview from silently dropping a reminder.
    reminders: [...(model?.reminders ?? [])],
    extra: [...(model?.extra ?? [])],
  };
  form.status = model?.status ?? ' ';
  form.description = model?.description ?? '';
  form.tags = (model?.tags ?? []).map((tag) => `#${tag}`).join(' ');
  form.id = model?.id ?? '';
  form.blockedBy = model?.blockedBy ?? '';
  form.recurrence = model?.recurrence ?? '';
  form.created = model?.created ?? '';
  form.start = model?.start ?? '';
  form.scheduled = model?.scheduled ?? '';
  form.due = model?.due ?? '';
  form.priority = model?.priority ?? '';
  form.cancelled = model?.cancelled ?? '';
  form.completed = model?.completed ?? '';
}

watch(
  () => props.open,
  (open) => {
    if (open) reset(props.model);
  },
  { immediate: true },
);

const toModel = (): TaskLineModel => {
  const next: TaskLineModel = {
    open: base.value.open,
    status: form.status,
    description: form.description,
    tags: form.tags
      .split(/\s+/u)
      .map((tag) => tag.replace(/^#+/u, ''))
      .filter(Boolean),
    id: form.id.trim(),
    blockedBy: form.blockedBy.trim(),
    recurrence: form.recurrence.trim().replace(/\s+/gu, ' '),
    created: form.created,
    start: form.start,
    scheduled: form.scheduled,
    due: form.due,
    priority: form.priority,
    cancelled: form.cancelled,
    completed: form.completed,
    reminders: base.value.reminders,
    extra: base.value.extra,
  };
  // Batch 8: whatever the user changed on one side of the status ↔ date link,
  // the other side follows before the line is written. The fields are compared
  // with the line as it was opened, so a date the dialog filled in itself does
  // not read as a change the user made.
  const original = props.model;
  linkTaskDates(
    next,
    {
      status: !!original && next.status !== original.status,
      completed: !!original && next.completed !== original.completed,
      cancelled: !!original && next.cancelled !== original.cancelled,
    },
    props.today,
  );
  return next;
};

const preview = computed(() => serializeTaskLine(toModel()));

/** DsSelect option lists, kept in sync with the inline <option>s this dialog
 *  used to render. Labels follow the dialog's zh/en switch like everything else. */
const statusOptions = computed<DsSelectOption[]>(() =>
  TASK_STATUSES.map((s) => ({
    value: s.char,
    label: `[${s.char}] ${pick(s.zh, s.en)}`,
  })),
);
const priorityOptions = computed<DsSelectOption[]>(() => [
  { value: '', label: pick('无', 'None') },
  ...TASK_PRIORITIES.map((p) => ({
    value: p.emoji,
    label: `${p.emoji} ${pick(p.zh, p.en)}`,
  })),
]);

const problem = computed(() => {
  if (form.recurrence.trim() && !compileNaturalRecurrence(form.recurrence.trim())) {
    return pick('重复规则无法解析，应形如 every 2 weeks', 'Unrecognised repeat rule — expected "every 2 weeks"');
  }
  for (const spec of TASK_DATE_FIELDS) {
    const value = form[spec.field];
    if (value && !ISO_RE.test(value)) return pick(`${spec.marker} 不是有效日期`, `${spec.marker} is not a date`);
  }
  if (/\s/u.test(form.id) || /\s/u.test(form.blockedBy)) {
    return pick('🆔 / ⛔ 不能包含空格', '🆔 / ⛔ cannot contain spaces');
  }
  return '';
});

function save(): void {
  if (problem.value) return;
  emit('save', toModel());
}
</script>

<template>
  <DsModal
    :model-value="open"
    :title="pick('任务编辑', 'Edit task')"
    width="560px"
    @update:model-value="emit('cancel')"
  >
    <div class="ted__body">
      <div class="ted__row">
        <label class="ted__field ted__field--narrow">
          <span class="ted__label">{{ pick('状态', 'Status') }}</span>
          <DsSelect v-model="form.status" :options="statusOptions" />
        </label>
        <label class="ted__field ted__field--narrow">
          <span class="ted__label">{{ pick('优先级', 'Priority') }}</span>
          <DsSelect v-model="form.priority" :options="priorityOptions" />
        </label>
      </div>

      <label class="ted__field">
        <span class="ted__label">{{ pick('描述', 'Description') }}</span>
        <DsInput v-model="form.description" />
      </label>

      <label class="ted__field">
        <span class="ted__label">{{ pick('标签（空格分隔）', 'Tags (space separated)') }}</span>
        <DsInput v-model="form.tags" placeholder="#work #urgent" />
      </label>

      <div class="ted__row">
        <label class="ted__field">
          <span class="ted__label">🆔</span>
          <DsInput
            v-model="form.id"
            :data-autofocus="focus === 'id' ? '' : undefined"
          />
        </label>
        <label class="ted__field">
          <span class="ted__label">⛔</span>
          <DsInput
            v-model="form.blockedBy"
            :data-autofocus="focus === 'blockedBy' ? '' : undefined"
          />
        </label>
      </div>

      <label class="ted__field">
        <span class="ted__label">🔁 {{ pick('重复规则', 'Repeat rule') }}</span>
        <DsInput
          v-model="form.recurrence"
          :placeholder="pick('every 2 weeks', 'every 2 weeks')"
        />
      </label>

      <div class="ted__grid">
        <label v-for="spec in TASK_DATE_FIELDS" :key="spec.field" class="ted__field">
          <span class="ted__label">{{ spec.marker }} {{ pick(spec.zh, spec.en) }}</span>
          <DatePickerPopover :iso="form[spec.field] ?? ''" @pick="(iso: string) => (form[spec.field] = iso)">
            <template #trigger="{ toggle }">
              <span class="ted__date">
                <input
                  :value="form[spec.field] ?? ''"
                  class="ted__input"
                  type="text"
                  :placeholder="pick('选择日期', 'Pick a date')"
                  @click.stop
                  @input="(e: Event) => (form[spec.field] = (e.target as HTMLInputElement).value)"
                />
                <button
                  type="button"
                  class="ted__date-icon"
                  :title="pick('选择日期', 'Pick a date')"
                  :aria-label="pick('选择日期', 'Pick a date')"
                  @click.stop="toggle"
                >
                  <Icons name="calendar" :size="14" />
                </button>
              </span>
            </template>
          </DatePickerPopover>
        </label>
      </div>

      <p v-if="problem" class="ted__problem">{{ problem }}</p>

      <div class="ted__preview">
        <span class="ted__label">{{ pick('预览', 'Preview') }}</span>
        <code class="ted__code">{{ preview }}</code>
      </div>
    </div>

    <template #footer>
      <DsButton variant="secondary" @click="emit('cancel')">{{ pick('取消', 'Cancel') }}</DsButton>
      <DsButton variant="primary" :disabled="!!problem" @click="save">{{ pick('保存', 'Save') }}</DsButton>
    </template>
  </DsModal>
</template>

<style scoped>
.ted__body {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  max-height: 62vh;
  overflow-y: auto;
}
.ted__row {
  display: flex;
  gap: var(--sp-3);
}
.ted__field {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.ted__field--narrow {
  flex: 0 0 46%;
}
.ted__label {
  color: var(--text-2);
  font-size: 12px;
}
.ted__input {
  box-sizing: border-box;
  width: 100%;
  height: 32px;
  font-family: var(--font-ui, inherit);
  font-size: 13px;
  color: var(--text);
  background: var(--fill-1);
  border: var(--bd-hair);
  border-color: var(--hairline);
  border-radius: var(--r-md);
  padding: 0 10px;
  transition: background-color var(--dur-fast) var(--ease),
    box-shadow var(--dur-fast) var(--ease);
}
.ted__input::placeholder {
  color: var(--text-3);
}
.ted__input:hover:not(:disabled):not(:focus) {
  background: var(--fill-2);
}
.ted__input:focus-visible,
.ted__input:focus {
  outline: none;
  background: var(--bg);
  box-shadow: var(--ring-tight);
}
.ted__input:disabled {
  opacity: 0.5;
  cursor: default;
}
.ted__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--sp-2, 8px) var(--sp-3);
}
.ted__date {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
}
.ted__date .ted__input {
  padding-left: 26px;
}
.ted__date-icon {
  position: absolute;
  left: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-3);
  border-radius: 4px;
  cursor: pointer;
}
.ted__date-icon:hover {
  background: var(--fill-2, rgba(0, 0, 0, 0.08));
  color: var(--text);
}
.ted__problem {
  margin: 0;
  color: var(--danger, #d33);
  font-size: 12px;
}
.ted__preview {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ted__code {
  display: block;
  padding: 8px;
  border: var(--bd-hair);
  border-radius: 6px;
  background: var(--fill-1);
  color: var(--text);
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
