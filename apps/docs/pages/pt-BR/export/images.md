# Imagens: PNG, JPEG e WebP

::: info Como esta página foi conferida
Cada passo foi seguido em 2026-10-19 numa versão de desenvolvimento do Tyto 0.7.0 (commit `e3d32e9`) no Windows 11, uma vez com a janela em inglês e outra em português do Brasil. Os menus e rótulos abaixo são os da janela em português.
:::

Marque **PNG**, **JPEG** ou **WEBP** na caixa Exportar para ter imagens. Qual escolher:

| Tipo | Serve para                                                                            |
| ---- | ------------------------------------------------------------------------------------- |
| PNG  | Os pixels exatos, sem perda. A escolha segura para postar e para provas de impressão. |
| JPEG | Arquivos menores onde uma pequena perda não aparece, como fotos.                      |
| WebP | Menores ainda, para a web; alguns programas mais antigos não abrem.                   |

Marcar mais de um faz cada imagem uma vez por tipo, lado a lado: `grid-01.png` e `grid-01.jpg`.

## Escala

**Escala** aparece quando um tipo de imagem está marcado, com duas opções:

- **1×** — cada arte no tamanho que o formato declara, como 1080 × 1350 num post de grid.
- **2×** — a mesma arte com o dobro de pixels, 2160 × 2700: mais nítida em telas de alta resolução e na impressão, com o mesmo layout.

A escala muda os pixels, não o design. Os arquivos SVG não são afetados por ela.

## Qualidade

**Qualidade** aparece quando JPEG ou WebP está marcado: um número de 1 a 100, 90 se você não mudar. Números menores fazem arquivos menores que perdem mais detalhe. O PNG não perde detalhe, então a qualidade não chega a ele; com só PNG marcado o campo não aparece.

## Quando uma imagem não é gravada

Se algo impede um arquivo de ser feito, a caixa mostra o motivo embaixo da barra de progresso, e o painel de Problemas também. Um que você pode encontrar:

- `E_EXPORT_FONT_UNRESOLVED` citando uma fonte _italic_: texto em `*itálico*` não pode ser exportado com as fontes que vêm com o Tyto, e nenhum arquivo é gravado para aquela arte. Tire o itálico do brief para exportar.

<!-- TYTO-329: itálico falha na exportação. Medido no e3d32e9 com `::titulo Open day at the *library*`: nenhum arquivo gravado. -->
