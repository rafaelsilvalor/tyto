# Instalar

O Tyto é um programa só, para Windows, macOS e Linux. Toda versão está na [página de versões](https://github.com/rafaelsilvalor/tyto/releases) do projeto, numa versão com o número dela; as do programa são as que têm etiqueta começando com `desktop-v`.

## Escolha o arquivo do seu computador

| Computador            | Arquivo                   | O que é                                                                                  |
| --------------------- | ------------------------- | ---------------------------------------------------------------------------------------- |
| Windows, instalando   | `Tyto-Setup-<versão>.exe` | Um instalador. O programa instalado se atualiza sozinho.                                 |
| Windows, sem instalar | `Tyto-<versão>.exe`       | Um arquivo só, que roda de onde estiver: uma pasta, um pendrive, ao lado de outra cópia. |
| macOS                 | `Tyto-<versão>-….dmg`     | Uma imagem de disco: abra e arraste o Tyto para Aplicativos.                             |
| Linux                 | `Tyto-<versão>.AppImage`  | Um arquivo só: permita que ele rode como programa e rode.                                |

Os arquivos `.blockmap` e `latest*.yml` da mesma página são do atualizador do programa, não para você.

::: warning O arquivo de Mac da 0.7.0 é só para Apple Silicon
Um `.dmg` cujo nome termina em `-arm64.dmg`, como o da 0.7.0, só abre num Mac com processador M1 ou mais novo. Num Mac com Intel ele não inicia.
:::

## Na primeira vez que você abrir

Os arquivos ainda não são assinados com certificado pago, então cada sistema avisa uma vez:

- **Windows** mostra "O Windows protegeu o computador". Clique em **Mais informações** e depois em **Executar assim mesmo**.
- **macOS** recusa a primeira tentativa. Clique com o botão direito no Tyto em Aplicativos, escolha **Abrir** e confirme.
- **Linux** só roda um AppImage depois que ele tem permissão de rodar como programa: nas propriedades do arquivo, ou com `chmod +x Tyto-<versão>.AppImage`.

A janela abre no idioma do computador — inglês ou português do Brasil — e com o esquema de cores dele. A página [Conheça a janela](./window-tour.md) dá nome ao que você vê.

## Onde o Tyto guarda as suas coisas

Configurações, atalhos de teclado, trechos, a posição dos painéis, os arquivos recentes e os logs ficam numa pasta própria de **cada versão**:

| Sistema | Pasta                                         |
| ------- | --------------------------------------------- |
| Windows | `%APPDATA%\Tyto\<versão>`                     |
| macOS   | `~/Library/Application Support/Tyto/<versão>` |
| Linux   | `~/.config/Tyto/<versão>`                     |

`<versão>` é a versão que você está usando, como aparece no topo deste manual e em **Ajuda ▸ Sobre o Tyto**. Duas versões no mesmo computador nunca leem a pasta uma da outra. Na primeira vez que uma versão nova abre, ela oferece trazer tudo isso da versão mais nova anterior a ela no computador: **Trazer** copia, **Começar do zero** não copia, a versão antiga continua com a cópia dela de qualquer jeito, e a pergunta não volta. Os logs nunca vêm junto.

Os plugins instalados com `tyto plugin install` ficam em outro lugar, comum a todas as versões: `~/.tyto` (no Windows, `%USERPROFILE%\.tyto`).

Se alguma coisa der errado, **Ajuda ▸ Abrir a pasta do log** abre a pasta `logs` dentro da pasta da versão.

## Atualizações

Ao abrir, o programa procura uma versão mais nova. O que acontece depois depende do arquivo que você instalou:

- **Instalador do Windows e AppImage do Linux:** a versão nova é baixada em segundo plano. Quando termina, a barra de status mostra **Versão … pronta — Reiniciar para atualizar**. Clique para reiniciar na hora, ou continue trabalhando: a atualização é instalada quando você fechar o programa. Ele nunca reinicia sozinho, e uma aba com texto não salvo continua perguntando antes de fechar.
- **Arquivo do Windows sem instalar e macOS:** a barra de status mostra **Versão … disponível — Baixar**, que abre a página da versão; você baixa e troca o arquivo na mão. No macOS é porque instalar uma atualização exige um programa assinado.

Sem internet o programa abre normalmente e não procura.

## Desinstalar

- **Windows, instalado:** Configurações ▸ Aplicativos ▸ Aplicativos instalados ▸ Tyto ▸ Desinstalar.
- **Windows sem instalar, Linux:** apague o arquivo.
- **macOS:** arraste o Tyto de Aplicativos para o Lixo.

Desinstalar deixa [as suas pastas](#onde-o-tyto-guarda-as-suas-coisas) onde estavam, e uma instalação futura encontra suas configurações. Para apagar tudo, apague a pasta `Tyto` dentro da pasta do seu sistema e a `.tyto` da sua pasta pessoal.
