# Solução de problemas

::: info Como esta página foi conferida
Cada passo e cada mensagem desta página foram vistos em 2026-10-19 numa versão de desenvolvimento do Tyto 0.7.0 (commit `b039537`) no Windows 11, com a janela em inglês e em português do Brasil. Os menus e rótulos abaixo são os da janela em português.
:::

## Comece pelo painel de Problemas

Quase tudo o que dá errado no Tyto aparece no painel de Problemas — num brief, num template, no `settings.json`, no `keybindings.json`, num plugin ou numa fonte. Cada linha tem um **código**: a primeira letra diz a gravidade, `E_` para um erro que impede alguma coisa e `W_` para um aviso que não impede. Clique numa linha para ir aonde aconteceu. Cada código está na lista de [códigos de diagnóstico](https://github.com/rafaelsilvalor/tyto/blob/main/docs/diagnostic-codes.md), em inglês, com o que quer dizer. As frases dos problemas também ainda aparecem em inglês com a janela em português.

<!-- TYTO-342: mensagens de problema em inglês na janela em português. -->

## Situações comuns

**A prévia parou de mudar.** O brief tem um erro: a prévia mantém o último desenho que funcionou até ele ser corrigido. O painel de Problemas diz o que e onde.

**A exportação terminou mas não gravou arquivo.** Leia as linhas embaixo da barra de progresso. `E_EXPORT_FONT_UNRESOLVED` citando uma fonte quer dizer que a fonte do template não tem uma variação que o brief pede, como o itálico; o painel de Problemas mostra o mesmo como `E_FONT_FACE_UNAVAILABLE` nessas palavras. Veja [Imagens](../export/images.md#quando-uma-imagem-nao-e-gravada).

**Uma configuração não faz nada.** Procure `W_SETTING_INVALID` (o valor não é um que a configuração aceita, então vale o padrão) ou `E_SETTINGS_SYNTAX` (o arquivo não pode ser lido, então a janela mantém as configurações que tinha). [settings.json](../customize/settings-json.md#quando-um-valor-esta-errado) explica os dois. E lembre de salvar: nada vale antes.

**Uma tecla não faz nada.** Ela pode ter sido tirada no `keybindings.json`, ou o modo vim pode estar ligado e ter ficado com ela — a barra de comandos mostra a tecla de cada comando como está agora. Veja [Atalhos de teclado](../customize/keybindings-json.md) e [Modo vim](../editor/vim-mode.md).

**Uma fonte aparece errada na janela.** `W_FONT_FAMILY_MISSING` quer dizer que uma fonte citada nas configurações não está neste computador, e a que vem com o Tyto é desenhada no lugar. Veja [Fontes e zoom](../customize/fonts-and-zoom.md).

**Algo mudou depois de instalar um plugin.** Desligue-o com `tyto plugin disable <nome>` e abra a janela de novo. Se o problema sumir, a causa é o plugin. Veja [Plugins](../customize/plugins.md).

**`tyto render` para com `E_FORMATS_READ`.** O arquivo que `--formats-file` aponta não existe. Confira o caminho, ou tire a opção: sem ela, vale o `formats.yaml` da pasta em que você executa o comando e, sem ele, os tamanhos que vêm com o Tyto; veja [Linha de comando](../command-line/#antes-da-primeira-renderizacao-tamanhos-e-templates).

## O log

O Tyto grava um log do que a janela fez: quando abriu, cada vez que o `settings.json` ou o `keybindings.json` mudou, e os avisos que encontrou. **Ajuda ▸ Abrir a pasta do log** abre a pasta; o arquivo é o `tyto.log`. Ele fica na pasta `logs` dentro da pasta da sua versão — veja [Onde o Tyto guarda as suas coisas](../get-started/install.md#onde-o-tyto-guarda-as-suas-coisas).

Cada linha tem a hora, o nível (`INFO`, `WARN`), a versão e o sistema, e o que aconteceu, em inglês:

```
2026-10-19T14:05:49.045Z | INFO | 0.7.0 | win32 | app started
2026-10-19T14:06:17.155Z | WARN | 0.7.0 | win32 | settings.json: Setting 'uiFontSize' is not accepted (Invalid input: expected number, received string); its default applies.
```

## Relatar um problema

Abra uma issue na [página do projeto no GitHub](https://github.com/rafaelsilvalor/tyto/issues) com:

1. **Que Tyto você tem.** **Ajuda ▸ Sobre o Tyto** mostra a versão, o sistema, quantos templates ele achou e qual pasta de templates está em uso. Copie essas quatro linhas.
2. **O que você fez e o que aconteceu**, passo a passo, e o que esperava no lugar.
3. **Os códigos do painel de Problemas**, copiados como estão.
4. **O log**, o `tyto.log` da pasta do log. Leia antes de enviar.
5. **O brief**, se o problema for com um — ou um brief menor que mostre o mesmo problema. Se ele usa um template seu, a pasta do template também.
