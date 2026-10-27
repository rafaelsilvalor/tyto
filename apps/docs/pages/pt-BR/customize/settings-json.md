# settings.json

::: info Como esta página foi conferida
Cada passo foi seguido em 2026-10-19 numa versão de desenvolvimento do Tyto 0.7.0 (commit `b039537`) no Windows 11, uma vez com a janela em inglês e outra em português do Brasil. Os menus e rótulos abaixo são os da janela em português.
:::

## Abrir

Execute **Preferências: Abrir configurações (JSON)** pela barra de comandos ou pelo menu **Arquivo**, ou clique no botão de configurações à direita da barra de status. O arquivo abre numa aba, como um brief. Uma configuração que você deixa de fora fica com o valor padrão, então o arquivo só precisa do que você muda.

## Mudar uma configuração

1. Escreva o nome da configuração entre aspas, dois-pontos e o valor, com vírgula entre uma configuração e outra. Ao digitar as aspas, o editor oferece os nomes, cada um com o tipo.
2. Salve (**Ctrl+S**). A mudança vale na hora, sem reiniciar; nada vale antes de salvar.

```jsonc
{
  "theme": "nord-adjusted",
  // Letra maior só no editor.
  "codeFontSize": 20,
  "uiFontSize": 15,
}
```

Linhas que começam com `//` são anotações suas. O Tyto as mantém: quando a própria janela escreve no arquivo — ao escolher um tema, ao dar zoom —, as suas anotações e a sua ordem ficam onde estavam.

[Configurações](../reference/settings.md) lista cada configuração, o tipo, o valor padrão e os valores que ela aceita.

## As configurações de um plugin

Um plugin que você instalou pode ter configurações próprias. Cada uma é escrita com o nome do plugin, um ponto e o nome da configuração, e é sugerida e conferida como as do próprio Tyto depois que o plugin inicia:

```jsonc
{
  "conector.baseUrl": "https://example.atlassian.net",
}
```

O plugin lê o valor na próxima vez que trabalha — a próxima exportação — e de novo a cada vez que você salva. A configuração de um plugin instalado mas desligado, ou que não conseguiu iniciar, não faz nada; o painel de Problemas diz a qual plugin ela pertence e que ele não está rodando.

<!-- TYTO-254: conferido por e2e/installed-plugins.desktop.test.ts, não seguindo os passos na janela. -->

## Quando um valor está errado

Um valor que o Tyto não consegue usar não trava nada. O painel de Problemas aponta o valor, com a linha, e o padrão vale só para aquela configuração; as outras continuam valendo:

```
W_SETTING_INVALID  Setting 'uiFontSize' is not accepted (Invalid input: expected number, received string); its default applies.
```

A mensagem ainda aparece em inglês com a janela em português.

<!-- TYTO-342: mensagens de problema em inglês na janela em português. -->

Se o próprio arquivo não pode ser lido — uma vírgula faltando, uma chave sobrando —, o painel mostra `E_SETTINGS_SYNTAX` com o ponto onde a leitura parou, e a janela mantém as configurações que tinha até o arquivo ser corrigido. O arquivo é salvo como você escreveu mesmo assim, então nada do que você digitou se perde.

<!-- TYTO-322: com o settings.json na frente o painel de Problemas diz "sobre este brief"; quer dizer este arquivo. -->
