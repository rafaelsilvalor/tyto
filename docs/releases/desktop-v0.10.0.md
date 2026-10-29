# Tyto 0.10.0

**A partir desta versão, um template que mora no próprio repositório chega ao Tyto por um arquivo de plugin, sem
terminal.** Você escreve uma linha dizendo de onde ele vem e qual versão, e o template aparece na lista, no menu "/" e em
**Novo brief a partir de template…**.

As versões 0.8 e 0.9 não foram publicadas: tudo o que elas trouxeram chega agora, junto com a 0.10.

## O que há de novo

**Templates de repositório próprio, por arquivo de plugin.** Crie a pasta `plugin-files` dentro de `.tyto`, na sua pasta
de usuário (no Windows, `%USERPROFILE%\.tyto\plugin-files`), e ponha nela um arquivo `.yaml` como este:

```yaml
version: 1
templates:
  tabela:
    source:
      git: https://github.com/rafaelsilvalor/tyto-template-tabela.git
      ref: v1.1.0
  concursos-abertos:
    source:
      git: https://github.com/rafaelsilvalor/tyto-template-concursos-abertos.git
      ref: v0.1.0
```

O Tyto busca esses templates quando abre, quando você abre uma pasta de trabalho e pelos comandos **Plugins: sincronizar
arquivos de plugins** e **Plugins: atualizar arquivos de plugins** (`Ctrl+K`). O segundo leva cada template para a versão
mais nova que o `ref` indicar. A busca usa o Git do seu computador, com o seu login, e guarda a versão que trouxe: o
template não muda sozinho até você pedir.

Na primeira vez, para cada template que usa uma fonte da casa, o Tyto pergunta **"Os arquivos de plugins pedem
'tabela', que pede estas permissões. Carregar?"**. Clique em **Carregar**. A pergunta aparece uma vez só por template;
**Agora não** deixa o template de fora, e a pergunta volta na próxima sincronização. Sem internet, a cópia trazida antes continua
funcionando, e o painel de problemas diz qual repositório não respondeu.

Uma pasta de trabalho também pode ter os seus, em `.tyto/plugin-files` ao lado dos briefs, e eles valem depois que você
confiar na pasta.

**Configurações e apelidos.** O mesmo arquivo pode dar a um template configurações com nome, que mudam os valores que o
template deixa mudar (uma cor, um tamanho, uma imagem). Um brief escolhe uma configuração pelo apelido: se o
arquivo der à tabela uma configuração `azul`, o brief escreve `template: tabela-azul`. No menu "/" e em **Novo brief a partir de template…**, um apelido aparece com o que
ele representa (`tabela · azul`), e o arquivo que o declara aparece ao passar o mouse. Uma configuração também pode dizer
como um brief novo começa: o texto inicial, os formatos e os campos que ela já preenche.

**Marca por configuração.** Uma configuração pode escolher a marca com `brand:`, e o template desenha o logotipo, a
assinatura e a cor daquela marca. Assim, a tabela roxa e a tabela azul podem ser um template só, com duas configurações.

**Também desde a 0.7.0:**

- **A janela volta como você deixou**: as mesmas abas, na mesma ordem, com o texto não salvo dentro delas e o cursor no
  mesmo lugar. Sair com trabalho não salvo não pergunta mais nada.
- **Pasta de trabalho**: **Arquivo ▸ Abrir pasta…** abre uma pasta, e o painel **Explorador** mostra os arquivos dela.
  Clique num brief para abrir; clique numa imagem para vê-la na prévia. Botão direito cria, renomeia e apaga arquivos e
  pastas.
- **Brief novo mais rápido**: uma `/` no começo da linha lista os templates, e **Novo brief a partir de template…** já
  escreve os campos que o template pede.
- **Editor dividido e prévia em aba**: `Ctrl+\` abre o brief numa segunda coluna, `Ctrl+Shift+V` abre a prévia ao lado.
  A prévia tem os modos **Um slide** e **Todos os slides**, e um carrossel mostra os slides numerados embaixo.
- **Ir para bloco…** (`Ctrl+Shift+O`) e **Arrumar brief** (`Alt+Shift+F`).
- **Temas de cor**: mais de vinte, em **Preferências: Tema de cores**. Tamanho de letra, fonte e barra de status se ajustam
  no `settings.json`, que agora abre numa aba com sugestões enquanto você digita.
- **Fontes que faltam** são baixadas do Google Fonts na primeira vez que um template pede.
- **Exportar** abre com PNG marcado e respeita os formatos que você desmarca.
- **Mac Intel**: o arquivo do Mac agora abre tanto no Apple Silicon quanto num Mac com processador Intel.
- **Menus de volta à barra de título** no Windows e no Linux, com `Alt` e a letra do menu.

## Para quem escreve plugins

O protocolo entre o Tyto e o processo de um plugin passou para a **versão 11** (`@tyto/plugin-api` 0.9.0). Um plugin
que roda o próprio processo e foi construído para a versão 10 é recusado ao conectar, com uma mensagem que diz os dois
números: reconstrua-o contra a `plugin-api` nova. Um pacote de templates como `tyto-template-tabela` e
`tyto-template-concursos-abertos` roda no ambiente do próprio Tyto e não precisa de nada: os dois carregaram e
desenharam nesta versão antes de ela sair.

## O que ela ainda não faz

**É preciso ter o Git instalado** para buscar templates por arquivo de plugin. Sem ele, a busca falha e o painel de
problemas diz qual repositório não veio.

**O carrossel de concursos abertos sai com a coruja e a assinatura provisórias**, até a marca `marinho` entrar no kit de
marcas.

**Uma configuração que pede uma marca que você não tem instalada** desenha o provisório sem avisar na janela. A linha de
comando avisa; a janela vai avisar numa versão próxima.

**O instalador não é assinado.** Na primeira vez que você abrir:

- **Windows**: o SmartScreen mostra "O Windows protegeu o computador". Clique em **Mais informações** e depois em
  **Executar assim mesmo**. Isso quer dizer que o arquivo não tem certificado pago, não que ele esteja infectado.
- **macOS**: o Gatekeeper recusa na primeira tentativa. Clique com o botão direito no aplicativo, escolha **Abrir** e
  confirme.

**No Mac e na versão do Windows que roda sem instalar, a atualização não é automática**: o rodapé mostra **"Versão X
disponível — Baixar"**, com um link para esta página. Quem instalou a 0.7.0 com `Tyto-Setup` no Windows, ou usa o Linux,
recebe esta versão sozinho.

## Se alguma coisa der errado

Me mande a pasta do log:

- Com a janela aberta: menu **Ajuda ▸ Abrir a pasta do log**.
- Se nem abriu: no Windows, cole `%APPDATA%\Tyto\0.10.0\logs` na barra do Explorador de Arquivos; no Mac,
  `~/Library/Application Support/Tyto/0.10.0/logs`; no Linux, `~/.config/Tyto/0.10.0/logs`.

Na primeira vez que a 0.10.0 abrir, ela oferece trazer da versão anterior a pasta de templates, a arrumação dos painéis,
os arquivos recentes e os seus atalhos de teclado.

## O que baixar

Os nomes abaixo são os dos arquivos como eles aparecem na página.

| Sistema                     | Arquivo                                                                     |
| --------------------------- | --------------------------------------------------------------------------- |
| Windows, instalando         | `Tyto-Setup-0.10.0.exe` (este se atualiza sozinho)                          |
| Windows, sem instalar       | `Tyto-0.10.0.exe`: um arquivo só, roda de onde estiver, serve para pendrive |
| macOS (Apple Silicon/Intel) | `Tyto-0.10.0-universal.dmg`                                                 |
| Linux                       | `Tyto-0.10.0.AppImage`: dê permissão de execução e rode                     |

Os arquivos `.blockmap` e `latest*.yml` que aparecem na lista não são para você: são do mecanismo de atualização
automática. Ignore.
