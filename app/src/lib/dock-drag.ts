import { reactive } from 'vue';
import type { SidebarSide } from './sidebar-dock';
import type { SidebarPaneId } from '../panes/sidebar-panes';

/** Where a dragged tab would land right now. */
export interface DockDropTarget {
  side: SidebarSide;
  group: number;
  /** Insertion point in the target group's `panes` array (n = append). */
  index: number;
}

/** Shared by both dock instances: only one drag can exist at a time, and the
 *  source/target live in different component trees. Transient — never
 *  persisted. Kept out of the store so it never leaks into localStorage. */
export const dockDrag = reactive<{
  id: SidebarPaneId | null;
  over: DockDropTarget | null;
}>({ id: null, over: null });
