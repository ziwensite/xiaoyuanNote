<script setup lang="ts">
/**
 * The ONE filter row for both task lists.
 *
 * `TasksPanel.vue` renders it without a search box; the task column in
 * `CalendarWorkspace.vue` renders it with one. Everything else — view, period
 * window, priority, calendar link and the window pager — is identical and
 * driven by the shared `useTaskFilter()` state, so the two lists can never
 * disagree about what is being shown.
 */
import { onBeforeUnmount } from 'vue';
import { useI18n } from '../../i18n';
import Icons from '../Icons.vue';
import { PERIOD_KINDS, TASK_VIEWS, useTaskFilter } from '../../composables/useTaskFilter';

const props = defineProps<{ showSearch?: boolean }>();
const { t } = useI18n();
const {
  view,
  query,
  windowOn,
  windowKind,
  priorityOnly,
  linked,
  windowRange,
  setView,
  setPeriod,
  toggleWindow,
  stepWindow,
  togglePriority,
  toggleLink,
} = useTaskFilter();

/** The query belongs to the view that renders the search box. Clear it when
 *  that view closes, so the sidebar is never left filtered by an invisible
 *  search term. Every other filter is meant to stay shared. */
onBeforeUnmount(() => {
  if (props.showSearch) query.value = '';
});
</script>

<template>
  <div class="task-filter-bar">
    <div class="task-filter-bar__row" :class="{ 'task-filter-bar__row--search': props.showSearch }">
      <input
        v-if="props.showSearch"
        v-model="query"
        type="search"
        class="task-filter-bar__search"
        :placeholder="t('calendar.filter.placeholder')"
        :aria-label="t('calendar.filter.placeholder')"
      />
      <select
        class="task-filter-bar__select"
        :value="view"
        :aria-label="t('tasks.view')"
        @change="setView"
      >
        <option v-for="f in TASK_VIEWS" :key="f" :value="f">
          {{ t(`tasks.filter.${f}`) }}
        </option>
      </select>
      <select
        v-if="windowOn"
        class="task-filter-bar__select"
        :value="windowKind"
        :aria-label="t('tasks.period.toggle')"
        @change="setPeriod"
      >
        <option value="off">{{ t('tasks.period.off') }}</option>
        <option v-for="kind in PERIOD_KINDS" :key="kind" :value="kind">
          {{ t(`tasks.period.${kind}`) }}
        </option>
      </select>
      <button
        v-else
        class="rp-icon-btn task-filter-bar__flag"
        type="button"
        :title="t('tasks.period.toggle')"
        :aria-label="t('tasks.period.toggle')"
        :aria-pressed="windowOn"
        @click="toggleWindow"
      >
        <Icons name="calendar" :size="14" />
      </button>
      <button
        class="rp-icon-btn task-filter-bar__flag"
        :class="{ 'is-on': priorityOnly }"
        type="button"
        :title="t('tasks.priorityOnly')"
        :aria-label="t('tasks.priorityOnly')"
        :aria-pressed="priorityOnly"
        @click="togglePriority"
      >
        <span class="task-filter-bar__bars task-filter-bar__bars--high" aria-hidden="true"><i /><i /><i /></span>
      </button>
      <button
        class="rp-icon-btn task-filter-bar__flag"
        :class="{ 'is-on': linked }"
        type="button"
        :title="t('tasks.linkCalendar')"
        :aria-label="t('tasks.linkCalendar')"
        :aria-pressed="linked"
        @click="toggleLink"
      >
        <Icons name="link" :size="14" />
      </button>
    </div>
    <div v-if="windowOn" class="task-filter-bar__range">
      <button
        class="task-filter-bar__step"
        type="button"
        :title="t('tasks.period.prev')"
        :aria-label="t('tasks.period.prev')"
        @click="stepWindow(-1)"
      >
        <Icons name="chevron-left" :size="14" />
      </button>
      <span class="task-filter-bar__range-text">{{ windowRange }}</span>
      <button
        class="task-filter-bar__step"
        type="button"
        :title="t('tasks.period.next')"
        :aria-label="t('tasks.period.next')"
        @click="stepWindow(1)"
      >
        <Icons name="chevron-right" :size="14" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.task-filter-bar__row {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  padding: 0 8px 8px 12px;
}
.task-filter-bar__search {
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 8px;
  border: var(--bd-hair);
  border-radius: var(--r-sm);
  background: var(--bg-input, var(--fill-1));
  color: var(--text);
  font: inherit;
  font-size: 12px;
}
.task-filter-bar__select {
  flex: 0 0 auto;
  width: auto;
  min-width: max-content;
  height: 26px;
  padding: 0 2px;
  border: 1px solid var(--line-2);
  border-radius: 6px;
  background: var(--surface-2);
  color: var(--text-1);
  font-size: 12px;
  cursor: pointer;
}
.task-filter-bar__select:hover {
  border-color: var(--line-3);
}
.task-filter-bar__step {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
}
.task-filter-bar__step:hover {
  background: var(--fill-1);
  color: var(--text-1);
}
.task-filter-bar__range {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 12px 8px;
  font-size: 12px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0;
}
.task-filter-bar__range-text {
  flex: 0 1 auto;
  min-width: 0;
  text-align: center;
}
.task-filter-bar__flag {
  width: 26px;
  height: 26px;
}
/* Priority: three ascending bars, filled by level (no emoji). */
.task-filter-bar__bars {
  flex-shrink: 0;
  display: inline-flex;
  align-items: flex-end;
  gap: 1.5px;
  height: 11px;
}
.task-filter-bar__bars i {
  display: block;
  width: 2.5px;
  border-radius: 1px;
  background: var(--fill-2);
}
.task-filter-bar__bars i:nth-child(1) { height: 5px; }
.task-filter-bar__bars i:nth-child(2) { height: 8px; }
.task-filter-bar__bars i:nth-child(3) { height: 11px; }
.task-filter-bar__bars--high i {
  background: var(--accent);
}
.task-filter-bar__flag:not(.is-on) .task-filter-bar__bars i {
  background: currentColor;
  opacity: 0.55;
}
</style>
