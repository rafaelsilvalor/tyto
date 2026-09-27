/**
 * The files a new template starts from — what `tyto template new` writes and what the desktop's
 * _New template_ writes, one function for both (TYTO-44).
 *
 * It lived in `apps/cli` until the desktop needed it, and an app may not import another app.
 * Here because it is text about this language and nothing else: pure, no disk, so each host
 * does its own writing with its own way of refusing to overwrite and of saying so.
 *
 * Deliberately small and deliberately complete: a manifest with one slot of each kind an
 * author will reach for, a body that draws them, and a brief that fills them. An author's
 * first edit should be changing something, not adding the first thing — and a template with
 * no brief is a template nothing can preview.
 */

/** The grammar's identifier, which is what a manifest name and a `--template` flag allow. */
export const TEMPLATE_NAME = /^[a-zA-Z_][a-zA-Z0-9_-]*$/u;

export const isTemplateName = (name: string): boolean => TEMPLATE_NAME.test(name);

export interface TemplateScaffold {
  /** `manifest.yaml`. */
  readonly manifest: string;
  /** `template.html`. */
  readonly markup: string;
  /** `examples/<name>.brief`, the brief a preview draws until the author writes their own. */
  readonly example: string;
}

function manifestFor(name: string, formats: readonly string[]): string {
  return `name: ${name}
version: 0.1.0
description: TODO — one line on what this template is for.
formats: [${formats.join(', ')}]
slots:
  titulo: { type: rich-text, required: true, max: 60 }
  imagem: { type: image }
  cor: { type: enum, values: [azul, laranja], default: azul }
`;
}

function markupFor(formats: readonly string[]): string {
  const [first = 'feed', ...rest] = formats;
  const extended = rest
    .map((format) => `<frame format="${format}" extends="${first}" />\n`)
    .join('');

  return `<!-- Scaffolded by \`tyto template new\`. The vocabulary is in
     docs/template-authoring.md; \`tyto template check\` reports on this file. -->

<frame format="${first}" bg="var(--bg)">
  <image slot="imagem" class="photo" />
  <text slot="titulo" class="title" />
</frame>
${extended}
<style>
  :root {
    --bg: #0c2340;
  }
  /* An enum reaches a value only through @if: --slot-cor holds the word, not the colour. */
  @if slot(cor) is laranja {
    :root {
      --bg: #ff5900;
    }
  }

  .photo {
    x: 0;
    y: 0;
    w: 100%;
    h: 60%;
  }
  /* The family is one \`@tyto/fonts\` ships: a face nobody bundles is a render that fails. */
  .title {
    x: 64;
    y: 70%;
    w: 80%;
    font: 700 72px/1.05 "Source Sans 3";
    color: white;
    overflow: shrink;
  }
</style>
`;
}

function exampleFor(name: string): string {
  // No `formats:` line, so the brief renders every format the manifest declares — which is
  // what an author adding a format expects to see appear. `docs/brief-language.md` is the
  // grammar.
  return `---
template: ${name}
cor: laranja
---
::titulo
  Primeiro **título**
`;
}

/** `formats` in the order the manifest should list them; the first is the one drawn in full. */
export function scaffoldTemplate(name: string, formats: readonly string[]): TemplateScaffold {
  return {
    manifest: manifestFor(name, formats),
    markup: markupFor(formats),
    example: exampleFor(name),
  };
}
