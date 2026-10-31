# Conheça a janela

Os nomes desta página são os que o resto do manual usa. A imagem mostra um brief aberto à esquerda e a prévia dele à direita, como a janela fica depois da [sua primeira arte](./first-artwork.md).

<!--
  Os marcadores são porcentagens da imagem `window-tour`, posicionados a olho. Eles não andam
  quando a imagem muda: depois que `pnpm --filter @tyto/desktop shots` gerar a imagem de novo
  (lista de cenas em apps/desktop/e2e/docs-shots/scenes.ts), olhe esta página nas duas edições
  e reposicione.
-->

<Screenshot
  scene="window-tour"
  alt="A janela do Tyto com um brief no grupo de editores da esquerda, a prévia dele no da direita, o painel de problemas embaixo e a barra de status no rodapé."
  :markers="[
    { n: 1, x: 33, y: 2 },
    { n: 2, x: 12.5, y: 6 },
    { n: 3, x: 6, y: 9 },
    { n: 4, x: 35, y: 37 },
    { n: 5, x: 67, y: 6 },
    { n: 6, x: 62, y: 9.25 },
    { n: 7, x: 7.5, y: 81.5 },
    { n: 8, x: 47, y: 97.5 },
  ]"
/>

1. **Barra de título** — os [menus](#os-menus), o nome da pasta aberta, que lista as [pastas abertas antes](../editor/workspace-folder.md#trocar-entre-pastas-recentes), e o nome do arquivo que está na frente. No macOS os menus e o título são os do sistema, no alto da tela.
2. **Aba** — uma para cada arquivo aberto. Uma aba com alterações ainda não salvas avisa; fechá-la pergunta antes. Pare o ponteiro sobre uma aba para ver onde o arquivo está: dentro da pasta aberta o caminho começa pelo nome da pasta, como `promo\briefs\capa.brief`, e fora dela a sua pasta pessoal aparece como `~`.
3. **Trilha** — onde o cursor está no brief: `cabeçalho` nas linhas entre os dois `---`, ou o bloco em que ele está. Parar o ponteiro sobre a linha dela mostra onde o arquivo está, como na aba.
4. **Grupo de editores** — uma fileira de abas e o arquivo da frente. **Dividir editor à direita** (**Ctrl+\\**) divide um grupo em dois, e o botão no fim da fileira de abas abre a prévia num grupo só dela; a imagem tem dois grupos lado a lado.
5. **Prévia** — uma aba como qualquer outra, no segundo grupo. Ela desenha o brief ao lado enquanto você digita e, enquanto o brief tem um erro, mantém o último desenho que deu certo.
6. **Barra da prévia** — os formatos que o brief pede (um botão para cada), **Um slide** e **Todos os slides** e o botão da faixa de slides de um carrossel, o zoom, **Ajustar** e **Travar**, que mantém a prévia neste brief quando você troca de aba.
7. **Painel de problemas** — o que há de errado no brief da frente, cada um com linha e coluna; clique num para ir até lá.
8. **Barra de status** — a linha e a coluna do cursor, o tipo de aba, o template do brief, o número de problemas, e botões para a fila, os plugins, a exportação, as configurações e as áreas da janela.

## Os menus

Cada item de menu executa um comando, o mesmo que a [barra de comandos](#a-barra-de-comandos) executa; então o que você acha num menu também pode ganhar um atalho. Um item que não faz nada com a aba da frente aparece apagado. No Windows e no Linux, Alt e a letra sublinhada abrem um menu.

- **Arquivo** — **Novo brief**, **Novo brief a partir de template…**, **Entrega: nova…**, **Abrir…**, **Abrir pasta…**, **Abrir pasta recente…**; **Salvar** e **Salvar como…**; **Fechar a aba** e **Fechar pasta**; **Sair** (**Sair do Tyto** no Linux).
- **Editar** — desfazer, refazer, recortar, copiar, colar, excluir e selecionar tudo.
- **Brief** — **Arrumar brief**, **Inserir: templates…** (o menu `/`), **Ir para bloco…**; **Exportar…** e **Entrega: exportar**; **Editar template…** e **Novo template…**.
- **Prévia** — abrir a prévia, ao lado do brief ou no grupo da frente, e travá-la; o slide seguinte ou o anterior, todos os slides ou um; o formato seguinte ou o anterior; zoom para ajustar, aumentar e diminuir.
- **Exibir** — dividir e passar entre grupos de editores; **Mostrar Problemas**, **Comandos: Executar…** e **Mostrar o Terminal**, as abas da área de baixo; ligar ou desligar o modo vim; recarregar a janela; o zoom da janela; tela cheia.
- **Ferramentas** — a galeria, os plugins, a fila local; um terminal novo; `settings.json`, `keybindings.json` e `snippets.json`; a confiança da pasta aberta.
- **Janela** — **Minimizar** e **Maximizar**.
- **Ajuda** — este manual, **Abrir a pasta do log** e **Sobre o Tyto**.

Os menus não mostram atalhos ao lado dos itens: a referência de [Comandos](../reference/commands.md) lista cada comando com o seu atalho.

## A barra de comandos

Tudo o que o programa faz é um comando, e **Ctrl+K** (**Cmd+K** no macOS) abre a barra que os executa: digite algumas letras do que você quer e aperte Enter. O atalho de cada comando aparece ao lado dele. O botão no começo da barra de status abre a mesma barra. Todos os comandos e seus atalhos estão em [Comandos](../reference/commands.md).

<Screenshot
  scene="command-bar-open"
  alt="A barra de comandos aberta sobre o editor, com a lista de comandos e seus atalhos."
/>

## Painéis e áreas

Os painéis ficam em três áreas em volta dos grupos de editores: **esquerda**, **direita** e **de baixo**. O painel de problemas abre na área de baixo. O painel **Fila local**, que renderiza briefs que outros programas colocam numa pasta, abre na área esquerda e começa fechado: abra com **Mostrar a fila local** na barra de comandos ou com o botão da fila na barra de status. Os botões nas duas pontas da barra de status mostram e escondem áreas inteiras, e **Restaurar a disposição padrão** devolve cada painel ao seu lugar.

A janela lembra onde você deixou os painéis e quais arquivos estavam abertos, e devolve tudo na próxima vez que abrir.

## Idioma e cores

A janela fala o idioma do computador — inglês ou português do Brasil — e **Trocar o idioma da janela** na barra de comandos troca. O tema de cores acompanha a opção clara ou escura do computador até você escolher um com **Preferências: Tema de cores**; a lista [Temas](../reference/themes.md) mostra todos.
