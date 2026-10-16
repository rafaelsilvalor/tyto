import {
  type DeclaredSetting,
  type SettingOutline,
  type ThemeContribution,
  outlineOf,
} from '@tyto/plugin-api';

/**
 * The outline `settings:outline` answers (TYTO-304, ADR 0092): the plugin API's, read off the
 * registry's schemas, with the `theme` setting's values filled in from the themes the plugins
 * registered — the one setting whose accepted values are not in its schema but in a lookup made
 * when it is checked.
 */
export function settingsOutline(
  declared: readonly DeclaredSetting[],
  themes: readonly ThemeContribution[],
): readonly SettingOutline[] {
  return outlineOf(declared).map((setting) =>
    // Unprefixed, so the built-in `desktop` plugin's: a plugin's would be `<id>.theme`.
    setting.key === 'theme' && setting.options.length === 0
      ? {
          ...setting,
          options: themes.map((theme) => ({
            value: theme.id,
            description: `${theme.label}, a ${theme.kind} theme.`,
          })),
        }
      : setting,
  );
}
