<script setup lang="ts">
/** In-app date picker popover — reuses the app's own calendar grid.
 *
 *  The pop-up container uses the shared `.prop-date-menu` surface from
 *  styles/menus.css (same background / border / radius / shadow / open
 *  animation as the right-click menus). The day view is rendered by the app's
 *  own `CalendarPanel` (the same compact month grid used in the sidebar and the
 *  main calendar), so it reads exactly like the rest of the calendar — same
 *  localisation, lunar/festival corners, note dots. `CalendarPanel` runs in
 *  `picker` mode here: clicks emit `pick` instead of mutating the shared focus
 *  date, the visible month is driven by `month`, and week selection / grid
 *  keyboard nav are disabled, so picking a date never moves the main calendar.
 *
 *  The header adds the "year / month quick jump" the native picker has: tapping
 *  the month title drills into a month grid, tapping the year title drills into
 *  a year grid (both lightweight, app-styled), like clicking the title of a
 *  native date control.
 *
 *  Used by the calendar header's date button and by the date property cell. */
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue';
import Icons from './Icons.vue';
import CalendarPanel from './CalendarPanel.vue';
import { useI18n, htmlLangFor } from '../i18n';
import { measureMenu, placeMenuFromPoint } from '../lib/menu-position';

const props = defineProps<{
  iso: string;
  mode?: 'date' | 'month';
  /** Anchor point (viewport coords) for opening without a trigger — used when
   *  the picker is mounted standalone (e.g. the frontmatter date control). */
  anchor?: { x: number; y: number };
  /** Open immediately on mount (standalone use, no trigger click). */
  autoOpen?: boolean;
}>();
const emit = defineEmits<{ pick: [string]; close: [] }>();

const { t, lang } = useI18n();

const triggerRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const open = ref(false);
const pos = ref({ left: 0, top: 0 });
const maxHeight = ref<number | null>(null);

type View = 'days' | 'months' | 'years';
const view = ref<View>('days');
// Controlled displayed month (YYYY-MM) for the day view.
function initialMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const localMonth = ref<string>(initialMonth());

function parseYM(s: string): { y: number; m: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((s || '').trim());
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]) - 1 };
}
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const selectedYM = computed(() => parseYM(props.iso));

// ── localisation for the lightweight month / year pickers ────────────────────
const monthsShort = computed(() => {
  const fmt = new Intl.DateTimeFormat(htmlLangFor(lang.value), { month: 'short' });
  return Array.from({ length: 12 }, (_, m) => fmt.format(new Date(2023, m, 1)));
});
const curYear = computed(() => Number(localMonth.value.slice(0, 4)));
const monthsSelected = computed(() =>
  selectedYM.value && selectedYM.value.y === curYear.value ? selectedYM.value.m : -1,
);
const yearBase = computed(() => Math.floor(curYear.value / 12) * 12);
const years = computed(() => Array.from({ length: 12 }, (_, i) => yearBase.value + i));
const yearsTitle = computed(() => `${yearBase.value} – ${yearBase.value + 11}`);

const dayTitle = computed(() => {
  const [y, m] = localMonth.value.split('-').map(Number);
  return new Intl.DateTimeFormat(htmlLangFor(lang.value), { year: 'numeric', month: 'long' }).format(
    new Date(y, m - 1, 1),
  );
});
const titleText = computed(() =>
  view.value === 'days' ? dayTitle.value : view.value === 'months' ? String(curYear.value) : yearsTitle.value,
);
const titleLabel = computed(() => (view.value === 'days' ? t('calendar.pickMonth') : t('calendar.pickYear')));
const navPrevLabel = computed(() =>
  view.value === 'days' ? t('inspector.prevMonth') : t('calendar.prev'),
);
const navNextLabel = computed(() =>
  view.value === 'days' ? t('inspector.nextMonth') : t('calendar.next'),
);

// ── navigation / drill-down ──────────────────────────────────────────────────
function step(dir: number) {
  if (view.value === 'days') {
    const [y, m] = localMonth.value.split('-').map(Number);
    const d = new Date(y, m - 1 + dir, 1);
    localMonth.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  } else if (view.value === 'months') {
    const [y] = localMonth.value.split('-').map(Number);
    localMonth.value = `${y + dir}-01`;
  } else {
    const base = yearBase.value + dir * 12;
    localMonth.value = `${base}-01`;
  }
}
function drillDown() {
  if (view.value === 'days') view.value = 'months';
  else if (view.value === 'months') view.value = 'years';
}
function selectMonth(m: number) {
  const [y] = localMonth.value.split('-').map(Number);
  const iso = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  // In month mode the picker only chooses a year/month — selecting a month is
  // the final step, so emit and close instead of drilling into the day grid.
  if (props.mode === 'month') {
    pick(iso);
    return;
  }
  localMonth.value = `${y}-${String(m + 1).padStart(2, '0')}`;
  view.value = 'days';
}
function selectYear(y: number) {
  const [, mo] = localMonth.value.split('-').map(Number);
  localMonth.value = `${y}-${String(mo).padStart(2, '0')}`;
  view.value = 'months';
}
function pick(iso: string) {
  emit('pick', iso);
  close();
}

async function openMenu(e?: Event) {
  view.value = props.mode === 'month' ? 'months' : 'days';
  const p = parseYM(props.iso);
  const ref = p ? new Date(p.y, p.m, 1) : new Date();
  localMonth.value = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}`;
  open.value = true;
  await nextTick();
  const el = panelRef.value;
  const tr = triggerRef.value;
  if (el) {
    // Anchor priority: explicit anchor point (standalone) > mouse click point
    // (like the other context menus) > trigger bounds (keyboard activation).
    let ax: number;
    let ay: number;
    if (props.anchor) {
      ax = props.anchor.x;
      ay = props.anchor.y;
    } else {
      const me = e as MouseEvent | undefined;
      if (me && typeof me.clientX === 'number' && (me.clientX > 0 || me.clientY > 0)) {
        ax = me.clientX;
        ay = me.clientY;
      } else if (tr) {
        const r = tr.getBoundingClientRect();
        ax = r.left;
        ay = r.bottom;
      } else {
        ax = window.innerWidth / 2;
        ay = window.innerHeight / 2;
      }
    }
    const placed = placeMenuFromPoint(ax, ay, measureMenu(el), { pad: 4 });
    pos.value = { left: placed.left, top: placed.top };
    if (placed.maxHeight !== undefined) maxHeight.value = placed.maxHeight;
  }
  panelRef.value?.focus();
}
function close() {
  open.value = false;
  maxHeight.value = null;
  emit('close');
}
function toggle(e?: Event) {
  if (open.value) close();
  else openMenu(e);
}

// Dismiss on a mousedown (left OR right) outside the panel and its trigger —
// capture phase, same as the other menus.
function onDocDown(e: MouseEvent) {
  if (!open.value) return;
  const t = e.target as Node;
  if (panelRef.value?.contains(t) || triggerRef.value?.contains(t)) return;
  close();
}
function onScroll(e: Event) {
  if (!open.value) return;
  if (panelRef.value && e.target instanceof Node && panelRef.value.contains(e.target)) return;
  close();
}
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !open.value) return;
  e.preventDefault();
  e.stopPropagation();
  close();
}
const onWindowClose = () => close();

onMounted(() => {
  document.addEventListener('mousedown', onDocDown, true);
  document.addEventListener('scroll', onScroll, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', onWindowClose);
  window.addEventListener('resize', onWindowClose);
  if (props.autoOpen) openMenu();
});
// Allow a host (e.g. App.vue) to drive a standalone instance.
defineExpose({ open: () => openMenu(), close });
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown, true);
  document.removeEventListener('scroll', onScroll, true);
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('blur', onWindowClose);
  window.removeEventListener('resize', onWindowClose);
});
</script>

<template>
  <span ref="triggerRef" class="date-picker-popover">
    <slot name="trigger" :open="open" :toggle="toggle" />
  </span>

  <Teleport to="body">
    <div
      v-if="open"
      ref="panelRef"
      class="prop-date-menu"
      role="dialog"
      :aria-label="titleLabel"
      tabindex="-1"
      :style="{
        left: `${pos.left}px`,
        top: `${pos.top}px`,
        maxHeight: maxHeight === null ? undefined : `${maxHeight}px`,
      }"
      @contextmenu.prevent
    >
      <div class="prop-date__head">
        <button type="button" class="prop-date__nav" :aria-label="navPrevLabel" @click="step(-1)">
          <Icons name="chevron-left" :size="14" />
        </button>
        <button
          v-if="view !== 'years'"
          type="button"
          class="prop-date__title"
          :aria-label="titleLabel"
          @click="drillDown"
        >
          <span>{{ titleText }}</span>
          <Icons name="chevron-down" :size="12" class="prop-date__caret" />
        </button>
        <span v-else class="prop-date__title prop-date__title--static">{{ titleText }}</span>
        <button type="button" class="prop-date__nav" :aria-label="navNextLabel" @click="step(1)">
          <Icons name="chevron-right" :size="14" />
        </button>
      </div>

      <!-- Day view: the app's own calendar month grid -->
      <CalendarPanel
        v-if="view === 'days'"
        :month="localMonth"
        :iso="props.iso"
        picker
        hide-header
        @pick="pick"
      />

      <!-- Month quick-jump -->
      <div v-else-if="view === 'months'" class="prop-date__months">
        <button
          v-for="(m, i) in monthsShort"
          :key="i"
          type="button"
          class="prop-date__cell"
          :class="{ 'prop-date__cell--selected': i === monthsSelected }"
          @click="selectMonth(i)"
        >{{ m }}</button>
      </div>

      <!-- Year quick-jump -->
      <div v-else class="prop-date__years">
        <button
          v-for="y in years"
          :key="y"
          type="button"
          class="prop-date__cell"
          :class="{ 'prop-date__cell--selected': selectedYM !== null && y === selectedYM.y }"
          @click="selectYear(y)"
        >{{ y }}</button>
      </div>

      <div class="prop-date__foot">
        <button type="button" class="prop-date__today" @click="pick(todayIso())">
          {{ t('inspector.today') }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.date-picker-popover {
  display: inline-flex;
}
/* Geometry only. Surface (background / border / radius / shadow / open
   animation / padding) comes from styles/menus.css via the shared
   `.prop-date-menu` rule, so this popover reads like the other menus. */
.prop-date-menu {
  position: fixed;
  /* Above modal layers (--z-modal is 2000) so the picker is never trapped
     behind a dialog/inspector that opened it. */
  z-index: 2100;
  width: 284px;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  outline: none;
}
.prop-date__head {
  display: flex;
  align-items: center;
  gap: 4px;
}
.prop-date__nav {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
}
.prop-date__nav:hover {
  background: var(--fill-1);
  color: var(--text);
}
.prop-date__title {
  flex: 1 1 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 0;
  height: 26px;
  padding: 0 4px;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.prop-date__title:hover {
  background: var(--fill-1);
}
.prop-date__title--static {
  cursor: default;
}
.prop-date__title--static:hover {
  background: transparent;
}
.prop-date__caret {
  opacity: 0.55;
  flex: 0 0 auto;
}
.prop-date__months {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}
.prop-date__years {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
}
.prop-date__cell {
  height: 32px;
  border: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 12px;
  border-radius: var(--r-sm);
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}
.prop-date__cell:hover {
  background: var(--fill-1);
}
.prop-date__cell--selected,
.prop-date__cell--selected:hover {
  background: var(--accent-strong);
  color: var(--accent-strong-fg);
  font-weight: 600;
}
.prop-date__foot {
  display: flex;
  justify-content: flex-end;
  margin-top: 2px;
  padding-top: 5px;
  border-top: var(--bd-hair);
}
.prop-date__today {
  height: var(--ctl-text-h, 26px);
  padding: 0 8px;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--accent-text);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
.prop-date__today:hover {
  background: var(--fill-1);
}
.prop-date__nav:focus-visible,
.prop-date__title:focus-visible,
.prop-date__cell:focus-visible,
.prop-date__today:focus-visible {
  outline: none;
  box-shadow: var(--ring);
}
</style>
