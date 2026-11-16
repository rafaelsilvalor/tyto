# Tyto 0.23.2

**A partir desta versão, o brief escreve fração de verdade numa fórmula (`$F = \frac{1}{40·10^{-3}} = 25\ Hz$`), o
texto embaixo de uma tag não precisa mais de recuo, e um template pode pôr uma tag dentro de outra.** O editor colore a
fórmula e recolhe a lâmina junto com o que vive dentro dela.

## O que há de novo

**Fórmula com fração.** Entre dois `$`, o brief escreve uma fórmula: `\frac{1}{40·10^{-3}}` desenha a fração
empilhada, com o 1 em cima, o traço e o denominador embaixo, `^` faz o sobrescrito e `_` o subscrito. A fórmula sai na
fonte do template, como o resto da lâmina. Valores em reais continuam texto: `R$ 50` e `R$50 a R$60` não abrem fórmula.
Um comando que o Tyto não conhece (como `\sqrt`), uma chave aberta ou uma fórmula vazia é um erro sublinhado no lugar
exato, e a fórmula sai como foi escrita.

**No editor, a fórmula aparece colorida**, parte por parte: o `$`, os comandos como `\frac`, as chaves e o `^` e o `_`.
**Ir para bloco** mostra a fórmula de um bloco em vez de deixá-la de fora.

**Recuo não é mais obrigatório.** O texto embaixo de uma tag pode começar na margem:

```
::titulo
Direito Constitucional
```

sai igual a quem recuou. Uma linha em branco entre duas linhas sem recuo separa parágrafos, como já acontecia com as
recuadas. Um `:titulo` com um dois-pontos só, que costuma ser erro de digitação, vira texto e ganha um aviso dizendo que
uma tag começa com `::`. Quem gosta de recuar continua vendo o recuo, e **Arrumar brief** recua por você.

**Uma tag dentro de outra.** Um template pode dizer que um `::bloco` vive dentro de uma `::lamina` e um `::paragrafo`
dentro de um `::bloco`, em quantos níveis quiser, e uma lâmina pode ter vários blocos. A tag pertence à última tag-mãe
escrita acima dela, com ou sem recuo. **Arrumar brief** recua cada nível sozinho, o caminho no topo do editor mostra a
cadeia (`::lamina 2 › ::bloco › ::paragrafo`), e recolher uma lâmina recolhe junto os blocos dentro dela. Nenhum
template da casa usa isso ainda: aparece quando um template novo precisar.

**Arrumar brief** também deixou de guardar linhas em branco que não separam nada, como a que fica entre uma tag sem
texto e um comentário.

**Uma mudança rara de comportamento.** Uma linha recuada que começa com `::` agora é uma tag, como na margem. Se algum
brief seu usava `::` recuado como texto, escreva `\::` no lugar. Num levantamento de 405 briefs, nenhum fazia isso.

## Para quem escreve templates e plugins

O `@tyto/core` chega à 0.48 e a `@tyto/plugin-api` à 0.22.2, sem mudar o protocolo:

- **Aninhamento pelo `per`.** No manifesto, `per` pode apontar para outro campo `per` (`paragrafo: { per: bloco }`), em
  qualquer profundidade, e `multiple: true` vale em qualquer nível. O template lê os campos da lâmina em
  `context.slots` como antes; os de baixo vêm em `slots` no campo pai, e os vários valores de um campo `multiple` em
  `occurrences`, com o primeiro ainda em `slots.bloco`.
- **Fórmula.** O texto do brief ganha o tipo `formula`, que carrega também a sua leitura em texto simples; um `switch`
  completo sobre o tipo do texto precisa tratar `formula`.

## O que ela ainda não faz

**Os templates em HTML** ainda não leem os níveis de baixo nem definem espaço entre parágrafos.

**Raiz quadrada, matriz e integral com limites** ainda não existem na fórmula.

**O instalador não é assinado.** Na primeira vez que você abrir:

- **Windows**: o SmartScreen mostra "O Windows protegeu o computador". Clique em **Mais informações** e depois em
  **Executar assim mesmo**. Isso quer dizer que o arquivo não tem certificado pago, não que ele esteja infectado.
- **macOS**: o Gatekeeper recusa na primeira tentativa. Clique com o botão direito no aplicativo, escolha **Abrir** e
  confirme.

**No Mac e na versão do Windows que roda sem instalar, a atualização não é automática**: o rodapé mostra **"Versão X
disponível — Baixar"**, com um link para esta página. Quem instalou com `Tyto-Setup` no Windows, ou usa o Linux, recebe
esta versão sozinho.

## Se alguma coisa der errado

Me mande a pasta do log:

- Com a janela aberta: menu **Ajuda ▸ Abrir a pasta do log**.
- Se nem abriu: no Windows, cole `%APPDATA%\Tyto\0.23.2\logs` na barra do Explorador de Arquivos; no Mac,
  `~/Library/Application Support/Tyto/0.23.2/logs`; no Linux, `~/.config/Tyto/0.23.2/logs`.

Na primeira vez que a 0.23.2 abrir, ela oferece trazer da versão anterior a pasta de templates, a arrumação dos painéis,
os arquivos recentes, os seus atalhos de teclado e as abas que estavam abertas.

## O que baixar

Os nomes abaixo são os dos arquivos como eles aparecem na página.

| Sistema                     | Arquivo                                                                     |
| --------------------------- | --------------------------------------------------------------------------- |
| Windows, instalando         | `Tyto-Setup-0.23.2.exe` (este se atualiza sozinho)                          |
| Windows, sem instalar       | `Tyto-0.23.2.exe`: um arquivo só, roda de onde estiver, serve para pendrive |
| macOS (Apple Silicon/Intel) | `Tyto-0.23.2-universal.dmg`                                                 |
| Linux                       | `Tyto-0.23.2.AppImage`: dê permissão de execução e rode                     |

O terminal vem dentro de cada um desses arquivos: não há nada a instalar à parte.

Os arquivos `.blockmap` e `latest*.yml` que aparecem na lista não são para você: são do mecanismo de atualização
automática. Ignore.
