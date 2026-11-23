import { patchFrontmatterWithReport, splitFrontmatter } from './frontmatter';

export const NOTE_TIMESTAMP_KEYS = {
  createdDate: 'created_date',
  createdTime: 'created_time',
  modifiedDate: 'modified_date',
  modifiedTime: 'modified_time',
} as const;

export interface NoteTimestampSource {
  createdAt?: Date | null;
  modifiedAt?: Date | null;
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

function localDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localIso(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const hours = pad(Math.floor(Math.abs(offset) / 60));
  const minutes = pad(Math.abs(offset) % 60);
  return `${localDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${hours}:${minutes}`;
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

/**
 * Apply the four managed timestamp fields without touching any other
 * frontmatter key or the note body. Existing created_* values win; modified_*
 * always reflects this write.
 */
export function applyNoteTimestamps(
  text: string,
  source: NoteTimestampSource = {},
): string {
  const createdAt = source.createdAt ?? new Date();
  const modifiedAt = source.modifiedAt ?? new Date();
  const { data } = splitFrontmatter(text);
  const patch: Record<string, unknown> = {
    [NOTE_TIMESTAMP_KEYS.createdDate]: hasValue(data[NOTE_TIMESTAMP_KEYS.createdDate])
      ? data[NOTE_TIMESTAMP_KEYS.createdDate]
      : localDate(createdAt),
    [NOTE_TIMESTAMP_KEYS.createdTime]: hasValue(data[NOTE_TIMESTAMP_KEYS.createdTime])
      ? data[NOTE_TIMESTAMP_KEYS.createdTime]
      : localIso(createdAt),
    [NOTE_TIMESTAMP_KEYS.modifiedDate]: localDate(modifiedAt),
    [NOTE_TIMESTAMP_KEYS.modifiedTime]: localIso(modifiedAt),
  };
  try {
    const result = patchFrontmatterWithReport(text, patch);
    if (result.degraded) {
      console.warn(`[note-timestamps] ${result.degraded.reason}: rewrote the whole block`);
    }
    return result.text;
  } catch (error) {
    console.warn('[note-timestamps] left frontmatter untouched:', error);
    return text;
  }
}
