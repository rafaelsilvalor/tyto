import { describe, expect, it } from 'vitest';

import { DEFAULT_TYPOGRAPHY, FONT_AREAS } from '../../shared/typography.js';
import { themeSheet } from './theme.js';
import {
  FONT_FAMILY_MISSING,
  type MeasureText,
  areaSelector,
  familyIsInstalled,
  fontAreaRules,
  missingFamilyRows,
  typographyDeclarations,
  withFontRows,
} from './typography.js';

/**
 * The person's faces and sizes as the window applies them (TYTO-272, ADR 0099): what the theme
 * sheet declares, and the row for a face the machine does not have. No canvas in Node, so the
 * measurement is a port and these tests are machines with and without a face.
 */

describe('typographyDeclarations', () => {
  it('declares nothing at the defaults, so tokens.css alone paints the window', () => {
    expect(typographyDeclarations(DEFAULT_TYPOGRAPHY)).toBe('');
  });

  it('declares each base that moved, in pixels', () => {
    expect(typographyDeclarations({ ...DEFAULT_TYPOGRAPHY, uiFontSize: 18 })).toBe(
      '\n  --tyto-ui-size: 18px;',
    );
    expect(typographyDeclarations({ ...DEFAULT_TYPOGRAPHY, codeFontSize: 20 })).toBe(
      '\n  --tyto-code-size: 20px;',
    );
  });

  it('puts the person’s face in front of the bundled one, which stays behind it', () => {
    const declared = typographyDeclarations({
      ...DEFAULT_TYPOGRAPHY,
      uiFontFamily: 'Segoe UI',
      codeFontFamily: 'Cascadia Code',
    });
    expect(declared).toContain(`--tyto-font-ui: "Segoe UI", 'Source Sans 3';`);
    expect(declared).toContain(`--tyto-font-mono: "Cascadia Code", 'IBM Plex Mono', monospace;`);
  });

  it('lands in the theme sheet’s light block, for both modes', () => {
    const colors = { surface: '#ffffff' };
    const sheet = themeSheet({
      light: { id: 'tyto-light', colors },
      dark: { id: 'tyto-dark', colors },
      typography: { ...DEFAULT_TYPOGRAPHY, uiFontSize: 16 },
    });
    const [light, dark] = sheet.split('@media (prefers-color-scheme: dark)');
    expect(light).toContain('--tyto-ui-size: 16px;');
    expect(dark).not.toContain('--tyto-ui-size');
  });
});

/** The declarations of the rule `fontAreaRules` writes for one area's selector. */
const ruleFor = (rules: string, area: string): string => {
  const start = rules.indexOf(`\n${areaSelector(area as never)} {\n`);
  if (start < 0) return '';
  return rules.slice(start, rules.indexOf('}', start));
};

describe('fontAreaRules (TYTO-272 PR B)', () => {
  it('writes nothing while no area is set, even with moved bases', () => {
    expect(fontAreaRules(DEFAULT_TYPOGRAPHY)).toBe('');
    expect(fontAreaRules({ ...DEFAULT_TYPOGRAPHY, uiFontSize: 18, codeFontSize: 20 })).toBe('');
  });

  it('gives a set area its size, and every other area its own base’s', () => {
    const rules = fontAreaRules({
      ...DEFAULT_TYPOGRAPHY,
      uiFontSize: 15,
      codeFontSize: 13,
      fontSizes: { tabs: 18, editor: 20 },
    });
    expect(ruleFor(rules, 'tabs')).toContain('--tyto-ui-size: 18px;');
    expect(ruleFor(rules, 'editor')).toContain('--tyto-code-size: 20px;');
    // Unset areas follow their base, the code base for json and the list, the UI base for
    // the rest — written out, since the list sits inside the editor and would read its 20.
    expect(ruleFor(rules, 'json')).toContain('--tyto-code-size: 13px;');
    expect(ruleFor(rules, 'completion')).toContain('--tyto-code-size: 13px;');
    expect(ruleFor(rules, 'statusBar')).toContain('--tyto-ui-size: 15px;');
    expect(ruleFor(rules, 'problems')).toContain('--tyto-ui-size: 15px;');
    expect(rules).not.toMatch(/--tyto-font-(?:ui|mono):/u);
  });

  it('writes a rule for every declared area, the list by its CodeMirror class too', () => {
    const rules = fontAreaRules({ ...DEFAULT_TYPOGRAPHY, fontSizes: { queue: 16 } });
    for (const area of FONT_AREAS) {
      expect(rules, area.id).toContain(`[data-font-area='${area.id}']`);
    }
    expect(areaSelector('completion')).toContain('.cm-tooltip.cm-tooltip-autocomplete');
  });

  it('puts an area’s face in front of its base’s bundled face, and the rest on their base', () => {
    const rules = fontAreaRules({
      ...DEFAULT_TYPOGRAPHY,
      codeFontFamily: 'Cascadia Code',
      fontFamilies: { problems: 'Segoe UI', json: 'Consolas' },
    });
    expect(ruleFor(rules, 'problems')).toContain(`--tyto-font-ui: "Segoe UI", 'Source Sans 3';`);
    expect(ruleFor(rules, 'json')).toContain(
      `--tyto-font-mono: "Consolas", 'IBM Plex Mono', monospace;`,
    );
    expect(ruleFor(rules, 'editor')).toContain(
      `--tyto-font-mono: "Cascadia Code", 'IBM Plex Mono', monospace;`,
    );
    expect(ruleFor(rules, 'tabs')).toContain(`--tyto-font-ui: 'Source Sans 3';`);
    expect(rules).not.toMatch(/--tyto-(?:ui|code)-size:/u);
  });

  it('lands in the theme sheet outside the dark block', () => {
    const colors = { surface: '#ffffff' };
    const sheet = themeSheet({
      light: { id: 'tyto-light', colors },
      dark: { id: 'tyto-dark', colors },
      typography: { ...DEFAULT_TYPOGRAPHY, fontSizes: { statusBar: 16 } },
    });
    const [light, dark] = sheet.split('@media (prefers-color-scheme: dark)');
    expect(light).toContain(`[data-font-area='statusBar'] {\n  --tyto-ui-size: 16px;`);
    expect(dark).not.toContain('data-font-area');
  });
});

/** A machine whose faces are `installed`: each draws its own width, a missing one the generic's. */
const machine = (...installed: string[]): MeasureText => {
  const generic = { monospace: 600, serif: 500, 'sans-serif': 550 } as Record<string, number>;
  return (font) => {
    const named = /"([^"]+)", (\S+)$/u.exec(font);
    if (named === null) return generic[font.replace('72px ', '')];
    const [, family, fallback] = named;
    return installed.includes(family!) ? 400 + family!.length : generic[fallback!];
  };
};

describe('familyIsInstalled', () => {
  it('finds a face the machine draws, and not one it lacks', () => {
    expect(familyIsInstalled('Consolas', machine('Consolas'))).toBe(true);
    expect(familyIsInstalled('Not A Font', machine('Consolas'))).toBe(false);
  });

  it('counts the bundled faces as always there, without measuring', () => {
    const never: MeasureText = () => {
      throw new Error('measured');
    };
    expect(familyIsInstalled('Source Sans 3', never)).toBe(true);
    expect(familyIsInstalled('IBM Plex Mono', never)).toBe(true);
  });

  it('says nothing where nothing can measure', () => {
    expect(familyIsInstalled('Consolas', () => undefined)).toBeUndefined();
  });

  it('finds a face that matches one generic by chance, from the other two', () => {
    // As wide as the monospace fallback, and not as the other two.
    const lookalike: MeasureText = (font) =>
      font.includes('"Lookalike"') ? 600 : machine()(font, '');
    expect(familyIsInstalled('Lookalike', lookalike)).toBe(true);
  });
});

describe('missingFamilyRows', () => {
  it('raises a warning per family setting the machine lacks, naming the setting and the face', () => {
    const rows = missingFamilyRows(
      { ...DEFAULT_TYPOGRAPHY, uiFontFamily: 'Gone Sans', codeFontFamily: 'Consolas' },
      machine('Consolas'),
      'This font is not installed',
    );
    expect(rows).toEqual([
      {
        severity: 'warning',
        code: FONT_FAMILY_MISSING,
        message: 'This font is not installed: uiFontFamily "Gone Sans"',
      },
    ]);
  });

  it('raises one for an area’s face too, naming the area (TYTO-272 PR B)', () => {
    const rows = missingFamilyRows(
      { ...DEFAULT_TYPOGRAPHY, fontFamilies: { problems: 'Gone Sans', tabs: 'Consolas' } },
      machine('Consolas'),
      'This font is not installed',
    );
    expect(rows.map((row) => row.message)).toEqual([
      'This font is not installed: fontFamilies.problems "Gone Sans"',
    ]);
  });

  it('raises nothing at the defaults', () => {
    expect(missingFamilyRows(DEFAULT_TYPOGRAPHY, machine(), 'x')).toEqual([]);
  });

  it('replaces only its own rows in the installation list', () => {
    const other = { code: 'E_THEME_INVALID' };
    const stale = { code: FONT_FAMILY_MISSING };
    const fresh = { code: FONT_FAMILY_MISSING };
    expect(withFontRows([other, stale], [fresh])).toEqual([other, fresh]);
    expect(withFontRows([other, stale], [])).toEqual([other]);
  });
});
