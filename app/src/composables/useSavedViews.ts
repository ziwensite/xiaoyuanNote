/**
 * Public surface for Saved Views (F5).
 *
 * Like {@link useBasesView}, this composable is event-based so it can drive
 * App.vue's content-area swap without modifying the off-limits stores. It also
 * exposes the saved-views Pinia store for components that need the data
 * directly (the sidebar panel, the editor dialog).
 *
 * Events on `window`:
 *   - `xiaoyuan-note:open-view`  (detail: { slug }) → render ViewNoteList for a view
 *   - `xiaoyuan-note:close-view`                    → back to the editor
 *   - `xiaoyuan-note:new-view`                      → open the view editor (create)
 *   - `xiaoyuan-note:edit-view`  (detail: { slug }) → open the view editor (edit)
 */
import { useSavedViewsStore } from '../stores/savedViews';
import { useSettingsStore } from '../stores/settings';

export const VIEW_OPEN_EVENT = 'xiaoyuan-note:open-view';
export const VIEW_CLOSE_EVENT = 'xiaoyuan-note:close-view';
export const VIEW_NEW_EVENT = 'xiaoyuan-note:new-view';
export const VIEW_EDIT_EVENT = 'xiaoyuan-note:edit-view';

export function useSavedViews() {
  const store = useSavedViewsStore();
  const settings = useSettingsStore();

  /** Select + render a view in the main content area. */
  function openView(slug: string) {
    store.setActive(slug);
    window.dispatchEvent(new CustomEvent(VIEW_OPEN_EVENT, { detail: { slug } }));
  }

  function closeView() {
    store.setActive(null);
    window.dispatchEvent(new CustomEvent(VIEW_CLOSE_EVENT));
  }

  /** Open the editor dialog to create a new view (reveals the panel first). */
  function newView() {
    if (!settings.showViewsPanel) settings.toggleViewsPanel();
    window.dispatchEvent(new CustomEvent(VIEW_NEW_EVENT));
  }

  /** Open the editor dialog for an existing view. */
  function editView(slug: string) {
    if (!settings.showViewsPanel) settings.toggleViewsPanel();
    window.dispatchEvent(new CustomEvent(VIEW_EDIT_EVENT, { detail: { slug } }));
  }

  return { store, openView, closeView, newView, editView };
}
