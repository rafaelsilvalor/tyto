# Tyto 0.12.0

**A partir desta versão, cada peça de trabalho pode ter a sua pasta, e o Tyto a cria e exporta para ela sem perguntar
nada.** **Arquivo ▸ Entrega: nova…** cria a pasta com o brief dentro, e um botão na aba do brief exporta a arte para essa
mesma pasta, com um clique.

A versão 0.11 não foi publicada: tudo o que ela trouxe chega agora, junto com a 0.12.

## O que há de novo

**Entregas: uma pasta por peça de trabalho.** Com uma pasta de trabalho aberta, escolha **Arquivo ▸ Entrega: nova…**. O Tyto pede o nome da entrega, a chave do card e um título, como
`mca-66910_simule-sua-nota-da-2ª-fase`, e avisa enquanto você digita se o nome não pode ser nome de pasta. Depois pede um
template, ou **Sem template**. Ele cria a pasta com `assets` e `editaveis` dentro, salva o brief em
`editaveis/<nome>.brief`, abre o brief numa aba nova e o marca no **Explorador**. Sem template, o brief abre com o menu
"/" para você escolher um.

**Exportar a entrega com um clique.** Ao lado de **Abrir a prévia ao lado** há um botão que exporta a entrega do brief
que está na frente, sem caixa para preencher: a caixa de exportação já abre exportando. A arte vai para a raiz da pasta
da entrega, e `result.json` e `template.txt` ficam ao lado do brief, em `editaveis`. Sem outra indicação, ela sai em PNG,
nos tamanhos que o brief pede. Para um brief que não está numa entrega, o botão fica cinza, e passar o mouse diz por quê.
O comando se chama **Entrega: exportar** e pode ganhar um atalho no `keybindings.json`.

Quer outra arrumação? A chave `delivery` no `.tyto/project.json` da pasta de trabalho muda onde as entregas são criadas,
que pastas elas ganham, onde fica o brief, para onde vai a arte e em que formatos e tipos ela sai.

**A caixa de exportação agora salva só a arte.** Ela e as predefinições de exportação escrevem apenas as imagens na pasta
que você escolher: não criam mais `editaveis` com o brief, nem `assets` com as imagens dele, nem `result.json`. Um arquivo
que uma exportação anterior deixou ali e esta não produziu fica onde está. Para guardar o brief e as imagens junto da
arte, use uma entrega.

**Pastas recentes na barra de título.** Depois do menu **Ajuda** há um botão com o nome da pasta aberta. Clique nele para
ver as pastas que você abriu antes, a mais nova primeiro: digite para filtrar, use as setas e `Enter` para abrir, `Esc`
para fechar, e **Abrir pasta local…** no fim da lista. O Tyto lembra as últimas dez. **Arquivo ▸ Abrir pasta recente…**
abre a mesma lista e pode ganhar um atalho no `keybindings.json`.

**Cada slide com a sua imagem.** Num template que permite, um slide pode levar a própria imagem: escreva `::imagem` logo
depois do `::lamina` daquele slide.

```
::lamina
  Primeira questão
::imagem ./questao-1.png
```

Se o arquivo não existir, o aviso aparece naquela linha. Num brief novo, o Tyto já escreve o `::imagem` embaixo de cada
slide.

**Aviso de marca que falta.** Quando um arquivo de plugin dá a um template uma configuração com uma marca que nenhum
plugin instalado tem, o painel de problemas mostra o aviso na linha `brand:` daquele arquivo. Antes, só a linha de comando
avisava; a janela desenhava o provisório em silêncio.

**Configurações que limitam os formatos.** Uma configuração no arquivo de plugin pode dizer, com `formats:` ao lado de
`brand:`, quais formatos ela produz. A lista de templates só oferece esses, e um brief ou uma exportação que peça outro
recebe um erro dizendo qual configuração limita.

**Uma configuração vale só para o template que o arquivo trouxe.** Se a sua pasta de trabalho tem um template com o mesmo
nome de um template do arquivo de plugin, o da pasta ganha, e a configuração do arquivo não se aplica a ele. O painel de
problemas avisa isso na linha do template, no arquivo de plugin.

**Desenho mais fiel:**

- **Texto centralizado com espaçamento entre letras** agora fica centralizado de verdade. Antes, uma linha com
  espaçamento ficava meio espaço para a esquerda, e uma linha alinhada à direita ficava um espaço inteiro antes da borda.
- **Sombra com espalhamento** (`spread`) agora aparece no PNG e na prévia, igual ao SVG. Antes, ela era deixada de fora
  com um aviso.
- **No SVG, uma fonte com nome que tem número**, como `Source Sans 3`, agora é usada de fato; antes, o navegador trocava
  por outra.

**Os templates de produção saíram do aplicativo.** O Tyto agora vem só com os templates de teste: `banner-roxo`,
`carrossel-lista` e `promo-curso`. `tabela-roxo`, `agenda-semana`, `aprovados` e os três `simulados-semana` não vêm mais
dentro dele: eles moram nos próprios repositórios (`tyto-template-tabela`, `tyto-template-agenda-semana`,
`tyto-template-aprovados` e `tyto-template-simulados-semana`) e chegam por um arquivo de plugin, como explicado na 0.10.0.
Sem esse arquivo, eles não aparecem na lista.

## Para quem escreve plugins

O protocolo entre o Tyto e o processo de um plugin passou da versão 11 para a **versão 13** (`@tyto/plugin-api` 0.11.0).
Um plugin que roda o próprio processo e foi construído para uma versão anterior é recusado ao conectar, com uma mensagem
que diz os dois números: atualize-o para a `plugin-api` nova. O que muda para um template de código:

- **Ele lê arquivos da própria pasta**, dentro do plugin instalado, por `context.files.image` e `context.files.svg`.
- **Ele sabe a largura e a altura de uma imagem**, e `imageHeight` do `@tyto/template-kit` dimensiona um quadro por ela.
- **Ele só desenha as imagens que recebeu**: as da própria pasta e as que vieram no pedido, como a imagem de um slot. Uma
  imagem apontada por caminho para qualquer outro lugar do disco agora é recusada, com um erro que diz o plugin, o
  template e a imagem.

## O que ela ainda não faz

**É preciso ter o Git instalado** para buscar templates por arquivo de plugin. Sem ele, a busca falha e o painel de
problemas diz qual repositório não veio.

**O carrossel de concursos abertos sai com a coruja e a assinatura provisórias**, até a marca `marinho` entrar no kit de
marcas.

**Uma entrega só se cria dentro de uma pasta de trabalho aberta.** Sem pasta aberta, **Entrega: nova…** pede que você abra
uma antes.

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
- Se nem abriu: no Windows, cole `%APPDATA%\Tyto\0.12.0\logs` na barra do Explorador de Arquivos; no Mac,
  `~/Library/Application Support/Tyto/0.12.0/logs`; no Linux, `~/.config/Tyto/0.12.0/logs`.

Na primeira vez que a 0.12.0 abrir, ela oferece trazer da versão anterior a pasta de templates, a arrumação dos painéis,
os arquivos recentes, os seus atalhos de teclado e as abas que estavam abertas.

## O que baixar

Os nomes abaixo são os dos arquivos como eles aparecem na página.

| Sistema                     | Arquivo                                                                     |
| --------------------------- | --------------------------------------------------------------------------- |
| Windows, instalando         | `Tyto-Setup-0.12.0.exe` (este se atualiza sozinho)                          |
| Windows, sem instalar       | `Tyto-0.12.0.exe`: um arquivo só, roda de onde estiver, serve para pendrive |
| macOS (Apple Silicon/Intel) | `Tyto-0.12.0-universal.dmg`                                                 |
| Linux                       | `Tyto-0.12.0.AppImage`: dê permissão de execução e rode                     |

Os arquivos `.blockmap` e `latest*.yml` que aparecem na lista não são para você: são do mecanismo de atualização
automática. Ignore.
