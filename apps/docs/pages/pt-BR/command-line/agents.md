# Conectar um agente de IA

::: info Como esta página foi conferida
Cada comando foi executado em 2026-11-09 num build de desenvolvimento da branch que o criou (TYTO-565, CLI 0.10.9) no Windows 11, com um pequeno substituto de agente que fala o protocolo do jeito que o Claude Code fala. As saídas abaixo foram copiadas dessas execuções.
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

## O que o agente pode fazer

Quatro coisas, e nenhuma muda um arquivo:

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

## O que fica fora do alcance dele

- **Só a pasta e a pasta de trabalho dela.** Um caminho fora delas é recusado, e também um atalho dentro da pasta que leva para fora.
- **Nenhuma senha ou chave.** Nenhuma resposta traz uma credencial, o ambiente de onde os plugins as leem, nem as configurações de plugin do `.tyto/project.json`.
- **Uma pasta em que você não confiou continua restrita.** Os arquivos de plugin dela não são carregados, como no `tyto render`. Ferramentas que escrevem arquivos estão planejadas; uma pasta em que você não [confiou](../editor/workspace-folder.md) não vai recebê-las.
- **Não pela janela.** A aba [Comandos](../editor/commands.md) recusa `tyto mcp`: o agente o inicia sozinho.

## Quando algo dá errado

O que o `tyto mcp` tem a dizer vai para o log do agente para aquele servidor, nunca para a conversa. Ao iniciar, ele diz qual pasta serve e se ela é confiável:

```
tyto mcp: serving on stdio, workspace restricted (C:\projects\tyto\testes\m565)
```

Se o agente disser que não alcança o Tyto, execute o mesmo comando num terminal: ele deve imprimir essa linha e esperar. Aperte Ctrl+C para pará-lo.
