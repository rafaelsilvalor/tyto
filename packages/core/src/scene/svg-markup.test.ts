import { describe, expect, it } from 'vitest';

import { checkSvgMarkup } from './svg-markup.js';

const NS = 'xmlns="http://www.w3.org/2000/svg"';

describe('checkSvgMarkup', () => {
  it.each([
    [
      'a single path',
      `<svg ${NS} viewBox="0 0 24 24"><path d="M2 2h20v20H2z" fill="#ff5900"/></svg>`,
    ],
    [
      'every shape inside a group',
      `<svg ${NS}><g transform="translate(1 2)" opacity="0.5"><rect x="0" y="0" width="4" height="4" rx="1"/><circle cx="1" cy="1" r="1"/><ellipse cx="1" cy="1" rx="1" ry="2"/><line x1="0" y1="0" x2="1" y2="1" stroke="#000" stroke-width="2"/><polyline points="0,0 1,1"/><polygon points="0,0 1,1 1,0" fill-rule="evenodd"/></g></svg>`,
    ],
    [
      "Illustrator's prologue, with Styling set to Presentation Attributes",
      `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generator: Adobe Illustrator 27.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0) -->\n<svg version="1.1" ${NS} xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 10 10" xml:space="preserve">\n  <path fill="#4D4D4D" d="M0 0h10v10H0z"/>\n</svg>\n`,
    ],
    ['a byte order mark', `\uFEFF<svg ${NS}><path d="M0 0"/></svg>`],
    ['a title with an entity', `<svg ${NS}><title>Seta &amp; caixa</title><path d="M0 0"/></svg>`],
    ['single quotes', `<svg xmlns='http://www.w3.org/2000/svg'><path d='M0 0' /></svg>`],
  ])('accepts %s', (_name, markup) => {
    expect(checkSvgMarkup(markup)).toBeUndefined();
  });

  it.each([
    [
      'a <style> block — the .cls-1 collision',
      `<svg ${NS}><defs><style>.cls-1 { fill: #4d4d4d; }</style></defs><path class="cls-1" d="M0 0"/></svg>`,
      'a <defs> element',
    ],
    ['a bare <style>', `<svg ${NS}><style>.a{}</style></svg>`, 'a <style> element'],
    [
      'a class',
      `<svg ${NS}><path class="cls-1" d="M0 0"/></svg>`,
      "the attribute 'class' on <path>",
    ],
    ['an id', `<svg ${NS}><path id="a" d="M0 0"/></svg>`, "the attribute 'id' on <path>"],
    [
      'an inline style',
      `<svg ${NS} style="position:fixed"><path d="M0 0"/></svg>`,
      "the attribute 'style' on <svg>",
    ],
    [
      'a gradient reference',
      `<svg ${NS}><path fill="url(#g)" d="M0 0"/></svg>`,
      "a url() reference in the attribute 'fill' on <path>",
    ],
    ['a script', `<svg ${NS}><script>alert(1)</script></svg>`, 'a <script> element'],
    [
      'an event handler',
      `<svg ${NS} onload="alert(1)"><path d="M0 0"/></svg>`,
      "the event handler 'onload' on <svg>",
    ],
    [
      'a link',
      `<svg ${NS}><a href="https://example.com"><path d="M0 0"/></a></svg>`,
      'a <a> element',
    ],
    ['an image', `<svg ${NS}><image href="x.png"/></svg>`, 'a <image> element'],
    ['a use', `<svg ${NS}><use xlink:href="#a"/></svg>`, 'a <use> element'],
    ['a foreignObject', `<svg ${NS}><foreignObject/></svg>`, 'a <foreignObject> element'],
    ['text to draw', `<svg ${NS}><text>Oi</text></svg>`, 'a <text> element'],
    [
      'loose text',
      `<svg ${NS}>Oi<path d="M0 0"/></svg>`,
      'text inside <svg>, which is not a shape',
    ],
    ['a DOCTYPE', `<!DOCTYPE svg><svg ${NS}/>`, 'a DOCTYPE or CDATA section'],
    ['CDATA', `<svg ${NS}><title><![CDATA[x]]></title></svg>`, 'a DOCTYPE or CDATA section'],
    [
      'an unknown entity',
      `<svg ${NS}><title>&nbsp;</title></svg>`,
      'an entity Tyto does not read in the text of <title>',
    ],
    ['an unquoted value', `<svg ${NS}><path d=M0 /></svg>`, "an unquoted value for 'd' on <path>"],
    [
      'a value with a tag in it',
      `<svg ${NS}><path d="</svg><script>"/></svg>`,
      "a '<' or '>' in the attribute 'd' on <path>",
    ],
    [
      'a comment that HTML ends early',
      `<svg ${NS}><!--><script>x</script>--><path d="M0 0"/></svg>`,
      'a comment that does not close cleanly',
    ],
    ['a second root', `<svg ${NS}/><svg ${NS}/>`, 'a second root element'],
    ['a root that is not svg', '<path d="M0 0"/>', 'a root <path> where <svg> belongs'],
    ['a nested svg', `<svg ${NS}><svg/></svg>`, 'an <svg> nested inside the file'],
    ['an element left open', `<svg ${NS}><g>`, 'a <g> that is never closed'],
    ['a mismatched end tag', `<svg ${NS}><g></svg>`, 'an end tag </svg> that closes nothing open'],
    ['nothing', '', 'no root <svg> element'],
  ])('refuses %s', (_name, markup, problem) => {
    expect(checkSvgMarkup(markup)).toBe(problem);
  });
});
