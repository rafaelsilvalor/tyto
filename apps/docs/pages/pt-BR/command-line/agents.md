# Conectar um agente de IA

::: info Como esta página foi conferida
Cada comando foi executado em 2026-11-09 num build de desenvolvimento da branch que o criou (TYTO-565, CLI 0.10.9) no Windows 11, com um pequeno substituto de agente que fala o protocolo do jeito que o Claude Code fala. As saídas abaixo foram copiadas dessas execuções. A seção sobre a janela aberta foi executada do mesmo jeito na branch que a criou (TYTO-566). A seção sobre o terminal do Tyto rodou pelos testes automáticos do projeto na branch que a criou (TYTO-567), e a linha de log foi copiada dessa execução; as duas linhas `claude mcp add` não foram executadas, e as pastas delas são as padrão dos instaladores, lidas na configuração deles. A seção sobre mudar arquivos foi conferida pelos testes automáticos do projeto na branch que a criou (TYTO-565, 2026-11-10); nenhuma saída nela foi copiada de uma execução à mão. A seção sobre o guia e os exemplos de um template foi conferida do mesmo jeito (TYTO-565, 2026-11-10).
:::

`tyto mcp` deixa um agente de IA, como o Claude Code ou o Claude Desktop, trabalhar com uma pasta de projeto: listar os templates, ler o que um template espera, conferir os erros de um brief e olhar a prévia da arte, antes de mostrar qualquer coisa a você. Ele fala o [Model Context Protocol](https://modelcontextprotocol.io), o jeito como esses agentes alcançam um programa no seu computador.

Você não o executa: avisa o agente uma vez, e o agente o inicia quando precisa.

## Avise o agente

O comando é `node <repositório>/apps/cli/dist/index.js mcp <pasta>`, em que `<pasta>` é a pasta do projeto em que o agente deve trabalhar. [Obter o comando](./index.md#obter-o-comando) diz como construí-lo.

**Claude Code**, num terminal:

```
claude mcp add tyto -- node C:/projects/tyto/tyto/apps/cli/dist/index.js mcp C:/projects/meu-projeto
```

**Claude Desktop**: abra **Settings ▸ Developer ▸ Edit Config**, acrescente a entrada `tyto` ao `claude_desktop_config.json` e reinicie o Claude Desktop:

```json
{
  "mcpServers": {
    "tyto": {
      "command": "node",
      "args": ["C:/projects/tyto/tyto/apps/cli/dist/index.js", "mcp", "C:/projects/meu-projeto"]
    }
  }
}
```

Depois peça com palavras comuns: "quais templates do Tyto eu tenho?", ou "escreva um brief para o banner com este texto e me mostre a prévia".

## Trabalhar com a janela aberta

`tyto mcp --window` liga o agente à janela do Tyto que você tem aberta, em vez de ler a pasta por conta própria. O agente recebe as mesmas ferramentas; enquanto a janela está aberta ela espera por um agente, e só um programa que consegue ler a chave da conexão na sua pasta do Tyto chega até ela — normalmente, só os programas rodando como você.

**Claude Code**:

```
claude mcp add tyto-window -- node C:/projects/tyto/tyto/apps/cli/dist/index.js mcp --window C:/projects/my-project
```

Com várias janelas abertas, ele escolhe aquela cuja pasta contém a pasta que você indicou, ou então a última aberta, e o log dele diz qual:

```
tyto mcp --window: no open window holds this folder; relaying to the most recent one, no folder (pid 28532)
```

Enquanto um agente está conectado, a barra de status mostra **Agente conectado** (com o número quando há mais de um). Clique nele para cortar todas as conexões; o servidor do agente para, e a janela continua esperando o próximo. Sem nenhuma janela aberta, o comando diz isso e para.

Pela janela o agente também pode:

- **Ler o brief da frente**: o nome, o formato que o preview mostra e o texto como está no editor, inclusive o que você digitou e não salvou. Um arquivo fora da pasta responde só com o nome.
- **Ler a seleção**: cada trecho selecionado com as linhas e colunas e o texto que ele cobre.
- **Abrir um arquivo** da pasta numa aba e **mostrar um formato** do brief da frente no preview. Esses dois exigem uma pasta em que você [confiou](../editor/workspace-folder.md), e por padrão a janela pergunta antes numa caixa que diz o arquivo ou o formato; você escolhe **Abrir** (ou **Mostrar**) ou **Não**. Uma pergunta por vez: enquanto uma caixa está aberta, outro pedido é recusado.

- **Propor uma mudança** no texto do documento da frente, numa pasta em que você confiou. Nada é gravado: a mudança aparece no editor, o texto antigo riscado e o novo ao lado, sob uma barra que diz **Proposto por um agente** com **Aceitar** e **Recusar**. Aceitar aplica tudo de uma vez, então um Ctrl+Z desfaz tudo; o arquivo não é salvo, como se você tivesse digitado. Se você digitar dentro do texto proposto antes de decidir, a proposta é descartada como desatualizada, nunca aplicada sobre o que você reescreveu. Uma proposta por documento de cada vez; o agente pergunta depois se você aceitou.

Duas [configurações](../reference/settings.md) mudam isso. `agentsWindowActions` em `"allow"` deixa o agente abrir e mostrar sem perguntar; uma mudança no texto de um documento é sempre uma proposta. `agentsListen` em `false` fecha a conexão, corta todos os agentes, e nenhum agente se conecta até ela voltar a `true`.

## Do terminal do Tyto

Num terminal que o Tyto abriu, **Terminal: Abrir um agente aqui** abre o Claude Code (ou o programa que `agentCommand` nomeia) já conectado àquela janela, sem nada para registrar; veja [Terminal](../editor/terminal.md#abrir-um-agente-aqui). Não precisa da linha de comando instalada: o app traz o pequeno programa que faz a conexão.

Para digitar `claude` você mesmo, registre esse programa uma vez. No Windows, com o Tyto instalado só para você (o padrão do instalador):

```
claude mcp add tyto-window -- "%LOCALAPPDATA%\Programs\Tyto\resources\node\node.exe" "%LOCALAPPDATA%\Programs\Tyto\resources\app.asar.unpacked\out\relay\agent-relay.js"
```

No macOS, com o Tyto em Aplicativos:

```
claude mcp add tyto-window -- /Applications/Tyto.app/Contents/Resources/node/node /Applications/Tyto.app/Contents/Resources/app.asar.unpacked/out/relay/agent-relay.js
```

Aberto num terminal do Tyto, ele chega à janela que abriu aquele terminal, e o log dele diz isso:

```
tyto mcp --window: relaying to the window that started this terminal, no folder (pid 11960)
```

Aberto em qualquer outro lugar, ele escolhe uma janela como `tyto mcp --window` escolhe. Esses caminhos continuam os mesmos quando o Tyto atualiza. O app portátil do Windows e o AppImage do Linux se descompactam numa pasta nova a cada vez que abrem; neles, use **Abrir um agente aqui**.

## O que o agente pode fazer

Quatro coisas que não mudam arquivo nenhum:

- **Listar os templates** que um brief na pasta pode usar: os seus, os que vêm com o Tyto e os que os plugins acrescentam.
- **Descrever um template**: os tamanhos, os campos que ele espera e o esqueleto de onde um brief novo começa.
- **Conferir um brief**, pelo caminho dele na pasta ou escrito por inteiro, e receber cada problema com linha e coluna:

  ```
  {
    "status": "error",
    "diagnostics": [
      {
        "severity": "error",
        "code": "E_UNKNOWN_SLOT",
        "message": "Unknown slot 'titlo'. Template 'banner-teste' declares: titulo.",
        "path": "briefs\\erro.brief",
        "line": 6,
        "column": 3,
        "hint": "Did you mean 'titulo'?"
      }
    ]
  }
  ```

  A conferência é sobre o brief em si; ela não procura fontes nem baixa imagens, então a prévia ainda pode avisar sobre isso.

- **Ver a prévia** de um tamanho como imagem. Um tamanho grande é reduzido a 1.024 pixels no lado maior, e um carrossel mostra os quatro primeiros slides, para as imagens caberem no que o agente consegue olhar. Um banner de 1200 × 628 voltou como um PNG de 1024 × 536.

## O que ele pode mudar, numa pasta em que você confia

Numa pasta em que você [confiou](../editor/workspace-folder.md), o agente também pode mudar arquivos, de quatro jeitos. Numa pasta em que você não confiou, eles nem são oferecidos.

- **Escrever um brief**: criar um arquivo `.brief` ou substituir um. Ele escreve briefs e mais nada, então não mexe no `.tyto/project.json`, num template nem nos arquivos de um plugin. Antes de substituir um brief ele pergunta o que mudaria e recebe as linhas tiradas e acrescentadas; depois precisa dizer qual versão leu, e um brief que alguém mudou nesse meio-tempo é recusado em vez de sobrescrito.
- **Criar uma entrega**, como o [`tyto delivery new`](./deliveries.md): a pasta, as pastas que o seu layout lista e o brief, começado de um template se ele nomear um. Um brief que já existe nunca é sobrescrito.
- **Exportar** a arte de um brief. Os arquivos vão para onde a sua pasta diz, nunca para onde o agente diz: a pasta de um preset de exportação, a pasta de exportação da entrega ou o `output` da pasta. Sem nenhum dos três, é recusado. Cancelar o pedido no agente para a exportação depois dos slides que já estão sendo desenhados.
- **Rodar uma receita** e ler as tabelas dela. Rodar não muda nada, nem numa receita marcada para aplicar sozinha: só mostra o que cada passo escreveria. Para executar as mudanças de um passo, o agente nomeia esse passo e o plano que viu; um plano que mudou desde então, ou que já foi executado, é recusado. As configurações de plugin da sua pasta chegam à receita e nunca ao agente.

**Um brief numa pasta que você tem aberta numa janela do Tyto não é substituído.** A janela fica com o texto que abriu, e o próximo salvar dela apagaria a mudança do agente sem aviso. O agente é orientado a propor a mudança na janela, com `tyto mcp --window`, onde você aceita ou rejeita. Ele ainda pode criar um brief novo ali.

## Ensine como um template se escreve

Os campos de um template dizem o que vai onde, não como o seu texto vira um brief. Um template pode trazer isso na própria pasta, e o agente lê antes de escrever:

- **Um guia**: um `guide.md` ao lado do `manifest.yaml` do template, nas palavras de quem o fez: que parte de um texto vai em que campo, como uma lista longa se divide em lâminas e os erros que já aconteceram. [Writing templates](https://github.com/rafaelsilvalor/tyto/blob/main/docs/template-authoring.md) diz o que pôr nele.
- **Exemplos**: os briefs da pasta `examples` do template.

O agente encontra os dois na lista de recursos que o Tyto oferece, e muitos agentes também mostram um pedido pronto, **Shape copy into a brief** (`model_brief`): você cola o texto e diz o template, e o agente recebe de uma vez os passos, os campos do template, o guia e os exemplos. Sem template, ele recebe a lista de templates para escolher.

Um guia é cortado em 64 KB e um exemplo em 16 KB, com uma linha dizendo isso, e só os oito primeiros exemplos são oferecidos. **Numa pasta em que você não confiou, os templates dela mesma não oferecem guia nem exemplos**: um guia é texto escrito para instruir um agente, e ninguém respondeu por essa pasta. Os templates que vêm com o Tyto e os que os plugins trazem continuam com os seus.

## O que fica fora do alcance dele

- **Só a pasta e a pasta de trabalho dela.** Um caminho fora delas é recusado, e também um atalho dentro da pasta que leva para fora.
- **Nenhuma senha ou chave.** Nenhuma resposta traz uma credencial, o ambiente de onde os plugins as leem, nem as configurações de plugin do `.tyto/project.json`.
- **Uma pasta em que você não confiou continua restrita.** Os arquivos de plugin dela não são carregados, como no `tyto render`. Nada que muda um arquivo é oferecido ao agente ali.
- **Não pela janela.** A aba [Comandos](../editor/commands.md) recusa `tyto mcp`, inclusive com `--window`: o agente o inicia sozinho.

## Quando algo dá errado

O que o `tyto mcp` tem a dizer vai para o log do agente para aquele servidor, nunca para a conversa. Ao iniciar, ele diz qual pasta serve e se ela é confiável:

```
tyto mcp: serving on stdio, workspace restricted (C:\projects\tyto\testes\m565)
```

Se o agente disser que não alcança o Tyto, execute o mesmo comando num terminal: ele deve imprimir essa linha e esperar. Aperte Ctrl+C para pará-lo.
