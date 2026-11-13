/** Shared row badges for both task lists (sidebar and main calendar view). */
import type { TaskPriority } from './tasks';

/** Obsidian Tasks priority glyphs (docs/specs … priority row): 🔺 ⏫ 🔼 🔽 ⏬. */
export const PRIORITY_ICON: Record<Exclude<TaskPriority, null>, string> = {
  highest: '🔺',
  high: '⏫',
  medium: '🔼',
  low: '🔽',
  lowest: '⏬',
};

export function priorityIcon(priority: TaskPriority): string | null {
  return priority ? PRIORITY_ICON[priority] : null;
}
