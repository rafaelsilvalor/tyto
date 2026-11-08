// The source the manual's recipe scene reads (TYTO-450): an invented reading list held in
// code, so the picture needs no network, no permission and no account. Plain JavaScript with
// no imports, as `tyto plugin new --code` writes it.

const WORDS = ['Quiet', 'Paper', 'Winter', 'Harbour', 'Lantern', 'Orchard'];
const THINGS = ['Rivers', 'Letters', 'Maps', 'Gardens', 'Bridges'];
const AUTHORS = ['A. Moreira', 'B. Castro', 'C. Nunes', 'D. Rocha', 'E. Pires', 'F. Lopes'];
const STATUSES = ['to read', 'reading', 'done'];
const ROWS = 30;

function day(index) {
  return new Date(Date.UTC(2026, 10, 2 + index)).toISOString().slice(0, 10);
}

function table() {
  // Three hours old, so the cell's age line reads like a fetch kept from earlier.
  const fetchedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const rows = [];
  for (let index = 0; index < ROWS; index += 1) {
    const id = String(index + 1);
    rows.push({
      key: 'B-' + id,
      values: {
        title: 'The ' + WORDS[index % WORDS.length] + ' ' + THINGS[index % THINGS.length],
        author: AUTHORS[(index * 5) % AUTHORS.length],
        status: STATUSES[index % STATUSES.length],
        due: day(index),
        link: 'https://example.com/books/' + id,
      },
      provenance: { source: 'reading', id, fetchedAt },
    });
  }
  return {
    columns: [
      { name: 'title', type: 'text', origin: 'reading' },
      { name: 'author', type: 'text', origin: 'reading' },
      { name: 'status', type: 'text', origin: 'reading' },
      { name: 'due', type: 'date', origin: 'reading' },
      { name: 'link', type: 'link', origin: 'reading' },
    ],
    rows,
  };
}

export function activate(host) {
  host.registerRecipeVerb({
    id: 'reading.list',
    kind: 'source',
    arguments: [],
    async page() {
      return { ok: true, value: { table: table() }, diagnostics: [] };
    },
  });
}
