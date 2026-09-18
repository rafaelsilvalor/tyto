# Tyto 0.3.0 — o primeiro beta

Primeira versão do Tyto que você pode instalar e usar sem ninguém do lado. Ela é um beta de
verdade: funciona, e tem buracos que estão escritos aqui embaixo em vez de te esperarem no
meio do caminho.

## O que dá para fazer

**Escrever um brief e ver a arte saindo enquanto você digita.** A janela tem o texto de um
lado e a peça pronta do outro, e a peça acompanha o que você escreve com uma pausa de dois
décimos de segundo. Erro no brief vira uma linha no painel de problemas, com o lugar exato —
clicar na linha leva o cursor até lá.

**Várias abas.** Cada brief aberto é uma aba, `Ctrl+1` até `Ctrl+9` vai direto numa delas, e
uma aba com texto não salvo pergunta antes de fechar. Fechar a janela inteira com trabalho
pendente também pergunta, e dizer não mantém o programa aberto.

**Exportar.** Escolhe a pasta, escolhe a peça, e sai PNG e SVG na mesma estrutura de pastas
que a linha de comando produz. Dá para acompanhar o progresso e cancelar no meio.

**Usar os seus próprios modelos.** Aponte o programa para uma pasta de modelos seus, nas
configurações, e ela passa a ser procurada **antes** dos modelos que vêm junto — o seu
`promo-curso` cobre o de fábrica, e os de fábrica que você não reescreveu continuam lá. Tirar
a pasta volta tudo ao normal sem reiniciar.

**Achar as coisas sem decorar atalho.** O menu Arquivo tem Novo, Abrir, Salvar, Salvar como e
Exportar. `Ctrl+K` abre uma lista de tudo o que o programa sabe fazer, filtrada enquanto você
digita. E o menu Ajuda abre a pasta do log — é o que você me manda quando algo der errado.

**Português e inglês**, trocáveis no rodapé a qualquer momento.

## O que ela ainda não faz

**Não se atualiza sozinha.** Quando sair uma correção, você baixa o instalador de novo. A
atualização automática é a próxima carta da fila.

**O instalador não é assinado.** Na primeira vez que você abrir:

- **Windows** — o SmartScreen mostra "O Windows protegeu o computador". Clique em **Mais
  informações** e depois em **Executar assim mesmo**. Isso é esperado: quer dizer que o
  arquivo não tem certificado pago, não que ele esteja infectado.
- **macOS** — o Gatekeeper recusa na primeira tentativa. Clique com o botão direito no
  aplicativo e escolha **Abrir**, e aí confirme.

**No Mac, só Apple Silicon (M1 em diante).** Um Mac com processador Intel baixa um arquivo que
não abre. Se for o seu caso, me avise antes de baixar.

**Não abre de volta as abas que você deixou abertas.** Toda vez você começa com uma aba vazia.

**Não tem menu de clique direito**, nem lista de arquivos recentes dentro do menu Arquivo — os
recentes estão no `Ctrl+K`.

## Se alguma coisa der errado

Se o programa quebrar ou não abrir, me mande a pasta do log:

- Com a janela aberta: menu **Ajuda ▸ Abrir a pasta do log**.
- Se nem abriu: no Windows, cole `%APPDATA%\Tyto\logs` na barra do Explorador de Arquivos; no
  Mac, `~/Library/Application Support/Tyto/logs`; no Linux, `~/.config/Tyto/logs`.

Essa pasta tem só o registro de falhas — nenhum texto dos seus briefs vai para lá, por
construção, e é a única pasta do programa que pode ser mandada inteira sem pensar duas vezes.

## O que baixar

| Sistema               | Arquivo                                                                     |
| --------------------- | --------------------------------------------------------------------------- |
| Windows, instalando   | `Tyto Setup 0.3.0.exe`                                                      |
| Windows, sem instalar | `Tyto 0.3.0.exe` — um arquivo só, roda de onde estiver, serve para pendrive |
| macOS (Apple Silicon) | `Tyto-0.3.0-arm64.dmg`                                                      |
| Linux                 | `Tyto-0.3.0.AppImage` — dê permissão de execução e rode                     |
