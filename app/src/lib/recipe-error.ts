/**
 * Decodes the `WORKSPACE_DIRTY|<total>|<hint>` refusal emitted by
 * `recipe_runner::dirty_workspace_error` before it reaches a toast.
 *
 * The backend caps the path list at 5 entries; the total is always exact,
 * so the UI can say "+N more" without shipping every path over IPC.
 */

const PREFIX = 'WORKSPACE_DIRTY|';
const MAX_SHOWN = 5;

export interface DirtyWorkspaceError {
  count: number;
  files: string[];
}

export function parseDirtyWorkspaceError(raw: string): DirtyWorkspaceError | null {
  const start = raw.indexOf(PREFIX);
  if (start < 0) return null;
  const rest = raw.slice(start + PREFIX.length);
  const newline = rest.indexOf('\n');
  const header = newline < 0 ? rest : rest.slice(0, newline);
  const count = Number.parseInt(header, 10);
  if (!Number.isFinite(count) || count <= 0) return null;
  const files =
    newline < 0
      ? []
      : rest
          .slice(newline + 1)
          .split('\n')
          .filter(Boolean)
          .slice(0, MAX_SHOWN);
  return { count, files };
}

/**
 * Turn the backend refusal into the localized "commit or discard these
 * files, then retry" message. Unknown errors pass through untouched so
 * unrelated failures keep their raw text.
 */
export function formatDirtyWorkspaceError(
  raw: string,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const parsed = parseDirtyWorkspaceError(raw);
  if (!parsed) return raw;
  const extra = parsed.count - parsed.files.length;
  const files =
    parsed.files.join(', ') + (extra > 0 ? ` … (+${extra})` : '');
  return t('recipes.acceptDirty', { count: parsed.count, files });
}
