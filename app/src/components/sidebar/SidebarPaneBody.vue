<script setup lang="ts">
/**
 * S1 — the one place that maps a sidebar pane id to its component.
 *
 * Extracted verbatim from the two near-identical `<aside>` blocks in App.vue
 * so the left and right sidebars can share a single render path. No wrapper
 * element: the rendered root IS the panel's root, which keeps
 * `.rs-pane-host > *` / `.rs-pane-host > .rs-pane-grip + *` in SidebarDock
 * matching the same element they matched before.
 */
import { defineAsyncComponent } from 'vue';
import type { ImplementedSidebarPaneId } from '../../panes/sidebar-panes';
import GlobalSearch from '../GlobalSearch.vue';
import Outline from '../Outline.vue';
import BacklinksPanel from '../BacklinksPanel.vue';
import Sidebar from '../Sidebar.vue';

const NeighborhoodPanel = defineAsyncComponent(() => import('../NeighborhoodPanel.vue'));
const RelationshipsPanel = defineAsyncComponent(() => import('../RelationshipsPanel.vue'));
const TagsPanel = defineAsyncComponent(() => import('../TagsPanel.vue'));
const TasksPanel = defineAsyncComponent(() => import('../TasksPanel.vue'));
const TypesPanel = defineAsyncComponent(() => import('../TypesPanel.vue'));
const HistoryPanel = defineAsyncComponent(() => import('../HistoryPanel.vue'));
const PropertiesInspector = defineAsyncComponent(() => import('../PropertiesInspector.vue'));
const AgentPanel = defineAsyncComponent(() => import('../AgentPanel.vue'));
// M1 — read-only. Async so a closed calendar costs nothing.
const CalendarPanel = defineAsyncComponent(() => import('../CalendarPanel.vue'));

const props = defineProps<{
  id: ImplementedSidebarPaneId;
  searchPrefill?: string;
  outlineLine: number;
}>();

const emit = defineEmits<{
  close: [];
  filterTag: [tag: string];
  outlineGoto: [line: number];
  openSettings: [section?: string];
  openQuickSwitcher: [];
}>();
</script>

<template>
  <Sidebar
    v-if="props.id === 'files'"
    embedded
    @open-settings="emit('openSettings')"
    @open-quick-switcher="emit('openQuickSwitcher')"
    @filter-tag="(tag: string) => emit('filterTag', tag)"
  />
  <GlobalSearch
    v-if="props.id === 'search'"
    :prefill="props.searchPrefill"
    @close="emit('close')"
  />
  <Outline v-if="props.id === 'outline'" :cursor-line="props.outlineLine" @goto="(line: number) => emit('outlineGoto', line)" />
  <BacklinksPanel v-if="props.id === 'backlinks'" @close="emit('close')" />
  <RelationshipsPanel v-if="props.id === 'relationships'" @close="emit('close')" />
  <TagsPanel
    v-if="props.id === 'tags'"
    @close="emit('close')"
    @filter-tag="(tag: string) => emit('filterTag', tag)"
  />
  <TasksPanel v-if="props.id === 'tasks'" @close="emit('close')" />
  <NeighborhoodPanel v-if="props.id === 'neighborhood'" @close="emit('close')" />
  <TypesPanel v-if="props.id === 'types'" @close="emit('close')" />
  <HistoryPanel v-if="props.id === 'history'" @close="emit('close')" />
  <PropertiesInspector v-if="props.id === 'inspector'" @close="emit('close')" />
  <AgentPanel
    v-if="props.id === 'agent'"
    @open-settings="(section?: string) => emit('openSettings', section ?? 'integrations')"
    @close="emit('close')"
  />
  <CalendarPanel v-if="props.id === 'calendar'" @close="emit('close')" />
</template>
