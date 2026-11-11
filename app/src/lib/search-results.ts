/**
 * Grouping and keyboard navigation shared by the search dropdown and the
 * search-results tab. Keeping it here means the flat selection index used by
 * ↑/↓ cannot disagree with the grouped list that is actually painted.
 */
import type { SearchHit } from '../composables/useGlobalSearch';

export interface HitGroup {
  file: string;
  hits: SearchHit[];
}

/** Group hits by file, preserving both the first-seen file order and the
 *  per-file hit order the backend returned. */
export function groupHits(hits: readonly SearchHit[]): HitGroup[] {
  const map = new Map<string, SearchHit[]>();
  for (const hit of hits) {
    const bucket = map.get(hit.file);
    if (bucket) bucket.push(hit);
    else map.set(hit.file, [hit]);
  }
  return Array.from(map, ([file, group]) => ({ file, hits: group }));
}

/** The visual order as one flat list; the selection index indexes this. */
export function flattenGroups(groups: readonly HitGroup[]): SearchHit[] {
  const flat: SearchHit[] = [];
  for (const group of groups) flat.push(...group.hits);
  return flat;
}

/** Clamped move over the flat hit list (crosses file-group boundaries). */
export function moveHitSelection(index: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(index + delta, 0), length - 1);
}
