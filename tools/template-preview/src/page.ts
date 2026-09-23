/**
 * The page. It draws nothing itself: it lists what `/api/state` says and points an `<img>`
 * at each file the server sends, so the browser's only job is to decode a PNG.
 *
 * One stream (`/events`) says a generation changed and the page re-reads the state, which
 * is what makes a save reach the screen without a reload.
 */

export const IDENTITY_STATEMENT =
  'Each image is the file tyto render wrote (Playwright Chromium with the determinism flags), ' +
  'byte for byte. The desktop app draws text through another Chromium and is not byte-identical ' +
  'to it on glyphs (ADR 0028).';

export function previewPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Template preview</title>
<style>
  :root { color-scheme: light dark; --fg: #1b1d22; --bg: #f4f4f2; --muted: #666a73; --card: #ffffff;
          --error: #b3261e; --warning: #8a5a00; --ok: #1d6b3a; --line: #d9d9d4; }
  @media (prefers-color-scheme: dark) {
    :root { --fg: #e7e7e3; --bg: #16181c; --muted: #9a9ea8; --card: #202329; --error: #ff8a80;
            --warning: #ffcc66; --ok: #7ad49a; --line: #33363d; }
  }
  body { margin: 0; padding: 16px; font: 14px/1.45 system-ui, sans-serif; color: var(--fg); background: var(--bg); }
  header { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: baseline; }
  h1 { font-size: 18px; margin: 0; }
  .status { font-weight: 600; }
  .status.ok { color: var(--ok); } .status.failed { color: var(--error); }
  .muted { color: var(--muted); }
  .identity { margin: 8px 0 12px; color: var(--muted); }
  code { font-family: ui-monospace, monospace; font-size: 12px; word-break: break-all; }
  ul.diagnostics { list-style: none; padding: 0; margin: 12px 0; }
  ul.diagnostics li { padding: 6px 8px; border-left: 3px solid var(--line); margin-bottom: 4px; background: var(--card); }
  ul.diagnostics li.error { border-color: var(--error); } ul.diagnostics li.warning { border-color: var(--warning); }
  .artwork { margin: 16px 0; }
  .artwork h2 { font-size: 14px; margin: 0 0 8px; }
  .frames { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
  figure { margin: 0; background: var(--card); padding: 8px; border: 1px solid var(--line); max-width: 100%; }
  figure img { display: block; max-width: min(100%, 540px); height: auto; }
  figcaption { margin-top: 6px; font-size: 12px; }
  .empty { padding: 24px; border: 1px dashed var(--line); color: var(--muted); }
</style>
</head>
<body>
<header>
  <h1 id="title">Template preview</h1>
  <span id="status" class="status"></span>
  <span id="timing" class="muted"></span>
</header>
<p class="identity">${IDENTITY_STATEMENT}</p>
<div><code id="command"></code></div>
<ul id="diagnostics" class="diagnostics"></ul>
<main id="images"></main>
<script>
  const byId = (id) => document.getElementById(id);
  const element = (tag, attributes, text) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes ?? {})) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  let shown = -1;

  async function refresh() {
    const state = await (await fetch('/api/state', { cache: 'no-store' })).json();
    byId('title').textContent = state.template + ' — ' + state.brief;
    const status = byId('status');
    status.textContent = state.status + (state.renderStatus ? ' (' + state.renderStatus + ')' : '') +
      ' · generation ' + state.generation;
    status.className = 'status ' + state.status;
    const timing = [];
    if (state.buildMs !== undefined) timing.push('build ' + state.buildMs + ' ms');
    if (state.renderMs !== undefined) timing.push('render ' + state.renderMs + ' ms');
    if (state.changeToPictureMs !== undefined) timing.push('change to picture ' + state.changeToPictureMs + ' ms');
    byId('timing').textContent = timing.join(' · ');
    byId('command').textContent = state.command ?? '';

    const list = byId('diagnostics');
    list.replaceChildren(...state.diagnostics.map((item) => {
      const where = item.path ? item.path + (item.line ? ':' + item.line + ':' + item.column : '') + ' ' : '';
      const row = element('li', { class: item.severity }, where + item.severity + ' ' + item.code + ': ' + item.message);
      if (item.hint) row.append(element('div', { class: 'muted' }, item.hint));
      return row;
    }));

    if (state.generation === shown) return;
    shown = state.generation;
    const main = byId('images');
    if (state.images.length === 0) {
      main.replaceChildren(element('div', { class: 'empty' },
        state.status === 'failed' ? 'No image: this generation failed, and nothing from before it is shown.' : 'Waiting for the first render.'));
      return;
    }
    const artworks = new Map();
    for (const image of state.images) {
      if (!artworks.has(image.artwork)) artworks.set(image.artwork, []);
      artworks.get(image.artwork).push(image);
    }
    main.replaceChildren(...[...artworks].map(([artwork, images]) => {
      const section = element('section', { class: 'artwork' });
      section.append(element('h2', {}, artwork));
      const frames = element('div', { class: 'frames' });
      for (const image of images) {
        const figure = element('figure', { 'data-format': image.format });
        figure.append(element('img', { src: image.url, alt: artwork + ' ' + image.format }));
        const caption = element('figcaption');
        caption.append(element('strong', {}, image.format + ' '), element('code', {}, image.sha256.slice(0, 16)),
          element('span', { class: 'muted' }, ' ' + image.bytes + ' bytes'));
        figure.append(caption);
        frames.append(figure);
      }
      section.append(frames);
      return section;
    }));
  }

  new EventSource('/events').onmessage = () => { refresh(); };
  refresh();
</script>
</body>
</html>
`;
}
