---
'@tyto/desktop': patch
---

TYTO-334: the window in Brazilian Portuguese no longer shows Electron's English in its menus. Every role item — Undo, Cut, Copy, Paste, Select All in Edit, Exit in File, the developer tools and full screen in View, Minimize and Zoom in Window, and macOS's application menu — carries the catalogue's word for it (Desfazer, Recortar, Copiar, Colar, Selecionar tudo, Sair, Ferramentas do desenvolvedor, Tela cheia, Minimizar, Maximizar), and the Edit list is written out so Electron no longer fills it in English. A new `keybindings.json` or `snippets.json` starts with its notes in the window's language, and the keybindings tab's suggestions and hover say what each field is in it too. Problem messages are still English (TYTO-342).
