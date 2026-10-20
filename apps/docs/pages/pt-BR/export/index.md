# Exportar

::: info Como esta página foi conferida
Cada passo foi seguido em 2026-10-19 numa versão de desenvolvimento do Tyto 0.7.0 (commit `e3d32e9`) no Windows 11, uma vez com a janela em inglês e outra em português do Brasil. Os menus e rótulos abaixo são os da janela em português.
:::

Exportar transforma o brief da frente em arquivos: imagens PNG, JPEG ou WebP, desenhos SVG, ou vários de uma vez.

## Exportar um brief

<Screenshot
  scene="export-dialog"
  alt="A caixa Exportar sobre um brief: uma pasta de destino, os tipos de arquivo PNG, JPEG, WEBP e SVG com PNG marcado, os formatos do brief marcados, e os botões Exportar e Fechar."
/>

1. Com o brief na frente, execute **Exportar…**: pelo menu **Arquivo**, pelo botão de exportar na barra de status ou pela barra de comandos.
2. Em **Pasta de destino**, clique em **Escolher…** e escolha para onde vão os arquivos. A caixa lembra a pasta enquanto a janela estiver aberta.
3. Em **Tipos de arquivo**, marque os tipos que você quer; a primeira exportação começa só com **PNG**. Cada tipo marcado é um arquivo por arte e por tamanho.
4. Em **Formatos**, desmarque os tamanhos que você não quer. Quando o brief tem uma linha `formats:`, a lista mostra só os tamanhos dela.
5. Clique em **Exportar**. Uma barra conta os arquivos enquanto são gravados — **7 / 8** — e **Cancelar** interrompe; os arquivos já gravados ficam.
6. Quando aparecer **Exportação concluída**, **Abrir pasta** mostra os arquivos.

**Escala** e **Qualidade** aparecem quando um tipo de imagem está marcado; [Imagens](./images.md) explica os dois.

## O que é gravado

Cada arquivo leva o nome do tamanho e o número da arte: `grid-01.png`, `grid-02.png`, `story-01.png` e assim por diante, então um carrossel de quatro faz quatro de cada.

Ao lado deles, uma pasta `editaveis` guarda o que é preciso para fazer os mesmos arquivos de novo: uma cópia do brief, um `template.txt` com o nome e a versão do template, e um `result.json` listando cada arquivo gravado.

## Nesta seção

- [Imagens](./images.md) — PNG, JPEG e WebP; escala e qualidade.
- [SVG](./svg.md) — desenhos que continuam nítidos em qualquer tamanho.
- [A pasta da fila](./queue-folder.md) — deixar outros programas largarem briefs para renderizar.

Pelo terminal, `tyto render` exporta do mesmo jeito; veja [Linha de comando](../command-line/).
