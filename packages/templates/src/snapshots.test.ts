import {
  type AssetRef,
  type AssetResolver,
  type FormatCatalogue,
  type Scene,
  type Template,
  type TemplateBuild,
  type TemplateFiles,
  defineTemplate,
  parseFormats,
  parseManifest,
} from '@tyto/core';
import { exportSvg } from '@tyto/export-svg';
import { compileTemplate, placeholderFont } from '@tyto/template-kit/testing';
import { describe, expect, it } from 'vitest';

import agendaBrief from '../templates/agenda-semana/examples/agenda.brief?raw';
import agendaManifest from '../templates/agenda-semana/manifest.yaml?raw';
import { build as agendaSemana } from '../templates/agenda-semana/template.js';
import aprovadosBrief from '../templates/aprovados/examples/aprovados.brief?raw';
import aprovadosManifest from '../templates/aprovados/manifest.yaml?raw';
import { build as aprovados } from '../templates/aprovados/template.js';
import agenciaBrief from '../templates/banner-roxo/examples/agencia.brief?raw';
import prefeituraBrief from '../templates/banner-roxo/examples/prefeitura.brief?raw';
import bannerManifest from '../templates/banner-roxo/manifest.yaml?raw';
import { build as bannerRoxo } from '../templates/banner-roxo/template.js';
import formatsYaml from '../templates/formats.yaml?raw';
import simuladosOcreBrief from '../templates/simulados-semana-ocre/examples/simulados.brief?raw';
import simuladosOcreManifest from '../templates/simulados-semana-ocre/manifest.yaml?raw';
import { build as simuladosOcre } from '../templates/simulados-semana-ocre/template.js';
import simuladosRoxoBrief from '../templates/simulados-semana-roxo/examples/simulados.brief?raw';
import simuladosRoxoManifest from '../templates/simulados-semana-roxo/manifest.yaml?raw';
import { build as simuladosRoxo } from '../templates/simulados-semana-roxo/template.js';
import simuladosVinhoBrief from '../templates/simulados-semana-vinho/examples/simulados.brief?raw';
import simuladosVinhoManifest from '../templates/simulados-semana-vinho/manifest.yaml?raw';
import { build as simuladosVinho } from '../templates/simulados-semana-vinho/template.js';
import quatroColunasBrief from '../templates/tabela-roxo/examples/quatro-colunas.brief?raw';
import tresColunasBrief from '../templates/tabela-roxo/examples/tres-colunas.brief?raw';
import tabelaManifest from '../templates/tabela-roxo/manifest.yaml?raw';
import { build as tabelaRoxo } from '../templates/tabela-roxo/template.js';

/**
 * The bytes every built-in code template writes for its own example briefs (TYTO-453).
 *
 * Each example goes through the real `parseBrief` → `resolve` → `compile` → exporter chain,
 * by `compileTemplate` (ADR 0152), and every frame's HTML and SVG is compared to a committed
 * file. The template tests beside each template assert what a template means; these assert
 * what it writes, so a house-style token that moves — `PAPER`, a margin — turns this red
 * even where those tests import the very token they check.
 *
 * **The same on every machine, by construction.** Nothing is measured (no faces: text keeps
 * the lines the template broke it into), every face is `placeholderFont`'s name, and no image
 * is read — the brief's pictures and a template's own files answer a ref named after their
 * path, embedded as that name. So neither the fonts a machine has (the CI has no CircularXX)
 * nor whether Git LFS fetched a PNG reaches a snapshot.
 *
 * Moving a template to its own repository (E18) copies its block below; the snapshots that
 * follow it are the proof the move kept its bytes.
 */

const FORMATS: FormatCatalogue = valueOf(parseFormats(formatsYaml, 'formats.yaml'));

/** A ref that stands for the file at `path` without its bytes; its id is what gets embedded. */
function refAt(path: string): AssetRef {
  return { id: path, source: 'file', path, hash: `test-${path}` };
}

/** The brief's images, every one found, none read. */
const ASSETS: AssetResolver = {
  base: '(snapshot test)',
  resolve: (reference) => Promise.resolve(refAt(reference)),
};

/** A template's own folder (`assets/bg-banner.png`), every image found, no SVG in it. */
const FILES: TemplateFiles = {
  svg: () => undefined,
  image: refAt,
};

const placeholderAsset = (ref: AssetRef): string => `tyto-test-asset:${ref.id}`;

function valueOf<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error, undefined, 2));
  return result.value;
}

function templateOf(manifest: string, build: TemplateBuild): Template {
  return defineTemplate(valueOf(parseManifest(manifest, 'manifest.yaml')), build, FILES);
}

interface Example {
  /** The example's file name without `.brief`, which names its snapshots. */
  readonly name: string;
  readonly brief: string;
}

/**
 * Compiles one example and compares each frame with `__snapshots__/<template>/`, as
 * `<example>.<artwork>.<format>.html` and `.svg`.
 */
function snapshotsOf(template: Template, examples: readonly Example[]): void {
  for (const example of examples) {
    it(`writes the bytes it wrote for ${example.name}.brief`, async () => {
      const compiled = valueOf(
        await compileTemplate({
          brief: example.brief,
          template,
          formats: FORMATS,
          assets: ASSETS,
          asset: placeholderAsset,
        }),
      );
      const svg = svgOf(compiled.scene);
      expect(svg).toHaveLength(compiled.frames.length);

      const folder = `./__snapshots__/${template.manifest.name}`;
      for (const [index, frame] of compiled.frames.entries()) {
        const file = `${folder}/${example.name}.${frame.artwork}.${frame.format}`;
        await expect(frame.html).toMatchFileSnapshot(`${file}.html`);
        await expect(svg[index]).toMatchFileSnapshot(`${file}.svg`);
      }
    });
  }
}

function svgOf(scene: Scene): readonly string[] {
  const exported = exportSvg(scene, {
    resources: { font: placeholderFont, asset: placeholderAsset },
  });
  return valueOf(exported).map((frame) => frame.svg);
}

describe('agenda-semana', () => {
  snapshotsOf(templateOf(agendaManifest, agendaSemana), [{ name: 'agenda', brief: agendaBrief }]);
});

describe('aprovados', () => {
  snapshotsOf(templateOf(aprovadosManifest, aprovados), [
    { name: 'aprovados', brief: aprovadosBrief },
  ]);
});

describe('banner-roxo', () => {
  snapshotsOf(templateOf(bannerManifest, bannerRoxo), [
    { name: 'agencia', brief: agenciaBrief },
    { name: 'prefeitura', brief: prefeituraBrief },
  ]);
});

describe('simulados-semana-ocre', () => {
  snapshotsOf(templateOf(simuladosOcreManifest, simuladosOcre), [
    { name: 'simulados', brief: simuladosOcreBrief },
  ]);
});

describe('simulados-semana-roxo', () => {
  snapshotsOf(templateOf(simuladosRoxoManifest, simuladosRoxo), [
    { name: 'simulados', brief: simuladosRoxoBrief },
  ]);
});

describe('simulados-semana-vinho', () => {
  snapshotsOf(templateOf(simuladosVinhoManifest, simuladosVinho), [
    { name: 'simulados', brief: simuladosVinhoBrief },
  ]);
});

describe('tabela-roxo', () => {
  snapshotsOf(templateOf(tabelaManifest, tabelaRoxo), [
    { name: 'quatro-colunas', brief: quatroColunasBrief },
    { name: 'tres-colunas', brief: tresColunasBrief },
  ]);
});
