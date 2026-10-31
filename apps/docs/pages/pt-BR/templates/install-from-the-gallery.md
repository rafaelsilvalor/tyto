# Instalar pela galeria

A galeria é uma lista de templates e plugins que alguém mantém, cada um num repositório próprio. O Tyto mostra essa lista, instala um item com um clique e **nunca atualiza nada sozinho**: quando sai uma versão nova, a galeria avisa e espera você.

## Abrir

Rode **Galeria: ver templates e plugins** na barra de comandos, ou **Ferramentas ▸ Galeria: ver templates e plugins**. Cada cartão mostra uma prévia, o nome, o que é, a versão e o estado:

- **Instalar**: nenhum arquivo de plugins seu tem esse item ainda.
- **Instalado em v1.2.0**: ele está nos seus arquivos de plugins nessa versão.
- **Atualizar para v1.3.0**: seus arquivos de plugins fixam uma versão mais antiga. O cartão diz qual, e o que muda na nova.
- **Precisa de um Tyto mais novo**: o item precisa de uma API de plugins mais nova do que a deste Tyto. Ele aparece na lista e não pode ser instalado.

Os botões no alto mostram todos os itens, só templates, só plugins, os instalados ou os que têm atualização, cada um com quantos são.

## Instalar e atualizar

**Instalar** escreve o item nos arquivos de plugins da sua máquina (`<TYTO_HOME>/plugin-files/`), fixado na versão que a galeria lista, e depois busca o item como **Plugins: sincronizar arquivos de plugins** faz. Um plugin que pede permissões pede na mesma caixa. Um template entra na lista de templates assim que a busca termina, sem reiniciar.

**Atualizar** muda a versão no arquivo que guarda o item, e nada mais, e depois busca o item. É a única coisa que muda uma versão: abrir a galeria, renderizar e sincronizar nunca mudam.

Um item que você mesmo escreveu num arquivo de plugins conta como instalado. Atualizar também muda esse item, e diz qual arquivo mudou. Se você alterou uma versão que a galeria escreveu, Atualizar recusa e diz o que escreveu e o que encontrou; para mudar mesmo assim, rode `tyto gallery update <id> --force` num terminal.

O que deu errado numa busca aparece no painel Problemas, como para qualquer arquivo de plugins.

## Qual lista ela lê

A [configuração](../reference/settings.md#galleryindex) `galleryIndex` diz qual é a lista: um repositório git com um `index.yaml`. Por padrão é a que o projeto Tyto mantém. Aponte para outro repositório, inclusive um privado, desde que o seu `git` consiga ler.

A lista é buscada toda vez que a galeria abre. Sem conexão, a galeria mostra a cópia buscada por último, prévias incluídas, e diz de quando é essa cópia. Uma lista que nunca foi buscada não mostra nada.

Na linha de comando, `tyto gallery list`, `tyto gallery install <id>` e `tyto gallery update <id>` fazem o mesmo, com `--index` ou `TYTO_GALLERY_INDEX` no lugar da configuração.
