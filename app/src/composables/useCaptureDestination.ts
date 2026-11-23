import { useI18n } from '../i18n';
import { captureTargetRelativePath, type CapturePreset } from '../lib/capture';
import { useSettingsStore } from '../stores/settings';

/**
 * Human-readable destination for a capture preset, shared by the quick-capture
 * window and the in-app prompt so both describe the same configured target.
 */
export function useCaptureDestination() {
  const { t } = useI18n();
  const settings = useSettingsStore();

  return function destinationOf(preset: CapturePreset): string {
    if (preset.target === 'inbox') return t('capture.target.inbox');
    if (preset.target === 'active') return t('capture.presetActiveHint');
    if (preset.target === 'periodic') return t(`settings.periodic.kinds.${preset.period}`);
    return captureTargetRelativePath(preset, settings.periodic, settings.weekStartsOn, new Date())
      || preset.path
      || t('capture.noTarget');
  };
}
