# Arquivos de texto e Markdown

::: info Como esta página foi conferida
Cada passo foi seguido em 2026-10-24 numa versão de desenvolvimento do Tyto no Windows 11, numa pasta com um `.brief`, um `.txt` e um `.md`, no tema claro e no escuro. A prévia de Markdown foi conferida no mesmo dia, nos dois temas, com uma tabela, uma lista de tarefas e um link. Os menus e rótulos abaixo são os da janela em português.
:::

O Tyto abre e edita arquivos de texto simples (`.txt`) e arquivos Markdown (`.md`) numa aba, ao lado dos seus briefs: anotações de uma campanha, uma lista de textos para conferir, um LEIA-ME. Um arquivo Markdown pode aparecer formatado numa prévia ao lado do texto. **O Tyto não gera arte a partir deles.** Só um `.brief` é exportado.

## Abrir um

- **Pelo Explorador**: clique num `.txt` ou num `.md`, ou selecione-o e aperte **Enter**. Ele abre numa aba, como um brief. Um arquivo que já está aberto é a aba dele.
- **Pelo menu Arquivo**: **Abrir…** (**Ctrl+O**) mostra os briefs primeiro. Escolha **Arquivos de texto** na lista de tipos da caixa para ver os `.txt` e `.md`, ou **Todos os arquivos suportados** para ver os três tipos juntos.
- **Um novo**: no Explorador, **Novo arquivo…** com um nome terminado em `.txt` ou `.md` cria o arquivo e o abre numa aba.

Outros arquivos, como `.json`, `.csv` ou `.yaml`, continuam não fazendo nada ao clique no Explorador.

## O que uma aba de texto faz

Uma aba de texto é para escrever, e o resto da janela sai do caminho:

- A barra de status diz o tipo: **Texto simples** para um `.txt`, **Markdown** para um `.md`.
- O painel **Problemas** diz _Arquivos de texto não são verificados._ Nada no Tyto lê o texto procurando erros.
- Não há **Exportar**, nem predefinições de exportação, nem os comandos de zoom, tamanho ou lâmina. A barra de comandos não os mostra enquanto uma aba de texto está na frente, e a barra de status não tem o botão **Exportar**.
- O texto fica na fonte do próprio editor. Um `.txt` não tem cores. Um `.md` é colorido como Markdown: títulos, ênfase e negrito, links e seus endereços, código, citações, e tabelas, listas de tarefas e texto riscado.

Salvar, o ponto que marca alterações não salvas e fechar funcionam como num brief. **Salvar como…** oferece a extensão da própria aba, então um `.md` é salvo como `.md`. Quando o Tyto abre de novo, a aba volta com o texto que você não tinha salvado.

Uma aba guarda o tipo enquanto fica aberta. Se você renomear `notas.brief` para `notas.md` no Explorador, a aba aberta continua sendo um brief até você fechá-la e abrir o arquivo de novo.

## Ver a prévia de um arquivo Markdown

Com um `.md` na frente, **Abrir a prévia ao lado** (o botão na ponta direita da fileira de abas, ou **Ctrl+Shift+V**) abre ao lado uma prévia que mostra o arquivo formatado: títulos, listas, citações, código, tabelas, listas de tarefas e texto riscado. Abrir um `.md` não abre prévia sozinho; um `.txt` não tem prévia.

- A prévia acompanha o que você digita depois de uma pequena pausa, como a de um brief.
- Traga outro `.md` ou um brief para a frente e a prévia passa a mostrá-lo. **Travar** a mantém no arquivo que ela mostra.
- Algumas coisas não aparecem, de propósito. **Uma imagem mostra só a descrição** (o texto entre os colchetes de `![descrição](imagem.png)`), não a figura. **Um link não é seguido**: o texto aparece sublinhado, e o clique não faz nada. **HTML escrito no arquivo aparece como texto**, sem rodar nem ser desenhado.
- Não há zoom, tamanho nem lâmina numa prévia de Markdown, e ela nunca é exportada.
