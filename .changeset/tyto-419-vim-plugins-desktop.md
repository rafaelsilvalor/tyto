---
'@tyto/desktop': minor
---

TYTO-419 and TYTO-442 (ADR 0143 amendment): vim mode in the desktop gains replaceWithRegister
(`gr`, `grr`), exchange (`cx`, `cxx`, `cxc`, visual `X`), part of unimpaired (`[<Space>`,
`]<Space>`, `[e`, `]e`), the indent and entire text objects (`ii`, `ai`, `ie`, `ae`), sneak
(`s`, `S`, `;`, `,`), the yank flash, and a yank shared with the system clipboard. Each is
switched by its own id in `vimPlugins`; all start on except sneak, which takes vim's own `s`
and `S`. A plain `y` copies to the system clipboard (`"ay` does not), and text copied in
another program is what `p` pastes once the editor has focus. The manual's Vim mode page and
the settings reference describe them, in English and Brazilian Portuguese.
