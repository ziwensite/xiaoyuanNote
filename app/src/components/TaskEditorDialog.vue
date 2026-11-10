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
import { DsButton, DsModal } from '../ui';
import { compileNaturalRecurrence } from '../lib/tasks';
import {
  TASK_DATE_FIELDS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  serializeTaskLine,
  type TaskLineModel,
} from '../lib/task-line';

const props = defineProps<{
  open: boolean;
  model: TaskLineModel | null;
  /** UI language; anything starting with `zh` gets Chinese. */
  lang: string;
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

/** The parts the form must not invent: the line's own prefix and leftovers. */
const base = ref<{ open: string; extra: string[] }>({ open: '- [', extra: [] });

function reset(model: TaskLineModel | null): void {
  base.value = { open: model?.open ?? '- [', extra: [...(model?.extra ?? [])] };
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

const toModel = (): TaskLineModel => ({
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
  extra: base.value.extra,
});

const preview = computed(() => serializeTaskLine(toModel()));

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
          <select v-model="form.status" class="ted__input">
            <option v-for="s in TASK_STATUSES" :key="s.char" :value="s.char">
              [{{ s.char }}] {{ pick(s.zh, s.en) }}
            </option>
          </select>
        </label>
        <label class="ted__field ted__field--narrow">
          <span class="ted__label">{{ pick('优先级', 'Priority') }}</span>
          <select v-model="form.priority" class="ted__input">
            <option value="">{{ pick('无', 'None') }}</option>
            <option v-for="p in TASK_PRIORITIES" :key="p.emoji" :value="p.emoji">
              {{ p.emoji }} {{ pick(p.zh, p.en) }}
            </option>
          </select>
        </label>
      </div>

      <label class="ted__field">
        <span class="ted__label">{{ pick('描述', 'Description') }}</span>
        <input v-model="form.description" class="ted__input" type="text" />
      </label>

      <label class="ted__field">
        <span class="ted__label">{{ pick('标签（空格分隔）', 'Tags (space separated)') }}</span>
        <input v-model="form.tags" class="ted__input" type="text" placeholder="#work #urgent" />
      </label>

      <div class="ted__row">
        <label class="ted__field">
          <span class="ted__label">🆔</span>
          <input v-model="form.id" class="ted__input" type="text" />
        </label>
        <label class="ted__field">
          <span class="ted__label">⛔</span>
          <input v-model="form.blockedBy" class="ted__input" type="text" />
        </label>
      </div>

      <label class="ted__field">
        <span class="ted__label">🔁 {{ pick('重复规则', 'Repeat rule') }}</span>
        <input
          v-model="form.recurrence"
          class="ted__input"
          type="text"
          :placeholder="pick('every 2 weeks', 'every 2 weeks')"
        />
      </label>

      <div class="ted__grid">
        <label v-for="spec in TASK_DATE_FIELDS" :key="spec.field" class="ted__field">
          <span class="ted__label">{{ spec.marker }} {{ pick(spec.zh, spec.en) }}</span>
          <input v-model="form[spec.field]" class="ted__input" type="date" />
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
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border: var(--bd-hair);
  border-radius: 6px;
  background: var(--fill-1);
  color: var(--text);
  font: inherit;
}
.ted__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--sp-2, 8px) var(--sp-3);
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
