/**
 * `arte-teste` — the pack's test template for external art (ADR 0220): a title over a
 * background and above a picture, both painted in another program.
 *
 * It places the two pictures as any template places a picture, by the size their refs carry
 * (ADR 0158). With no file yet the refs are placeholders sized from the manifest's
 * declaration, and `compile` draws each as an outlined box in the place given here.
 */

import { frame, image, runsOf, text } from '@tyto/core/template';
import { imageHeight } from '@tyto/template-kit';

import type { NodeDraft, TemplateBuild } from '@tyto/core/template';

/** The title's colour, dark on a pale paper. */
export const INK = '#1f2933';

/** Where each format puts the title and the picture under it. */
const LAYOUTS: Readonly<Record<string, { readonly title: number; readonly picture: number }>> = {
  'grid-1x1': { title: 80, picture: 300 },
  story: { title: 160, picture: 520 },
};

const MARGIN = 80;
const WIDTH = 920;

/** The picture's height when its ref carries none: the square post's declared one. */
const PICTURE_HEIGHT = 560;

export const build: TemplateBuild = (context) => {
  const layout = LAYOUTS[context.format] ?? { title: MARGIN, picture: 300 };
  const children: NodeDraft[] = [];

  const fundo = context.slots.fundo?.value;
  if (fundo?.kind === 'image') {
    children.push(
      image({ id: `${context.idPrefix}.fundo`, asset: fundo.asset, size: context.size }),
    );
  }

  const titulo = context.slots.titulo?.value;
  if (titulo?.kind === 'rich-text') {
    const [first, ...rest] = runsOf(titulo.text, {
      font: { family: 'Source Sans 3', source: 'bundled' },
      size: 72,
      color: INK,
    });
    if (first !== undefined) {
      children.push(
        text({
          id: `${context.idPrefix}.titulo`,
          runs: [first, ...rest],
          box: { w: WIDTH, h: 180 },
          lineHeight: 1.1,
          transform: { x: MARGIN, y: layout.title },
        }),
      );
    }
  }

  const imagem = context.slots.imagem?.value;
  if (imagem?.kind === 'image') {
    children.push(
      image({
        id: `${context.idPrefix}.imagem`,
        asset: imagem.asset,
        size: { w: WIDTH, h: imageHeight(imagem.asset, WIDTH, PICTURE_HEIGHT) },
        transform: { x: MARGIN, y: layout.picture },
      }),
    );
  }

  return frame({
    format: context.format,
    size: context.size,
    background: { kind: 'solid', color: { r: 247, g: 245, b: 240, a: 1 } },
    children,
  });
};
