# Tyto 0.7.0

**A partir desta versão, o Tyto se atualiza sozinho.** Esta é a última vez que você baixa o instalador na mão: as
próximas versões chegam pelo próprio programa.

## O que há de novo

**Atualização automática.** Ao abrir, o Tyto procura uma versão nova e, se houver, baixa sem atrapalhar o seu trabalho.
Quando terminar, o rodapé mostra **"Versão X pronta — Reiniciar para atualizar"**. Você pode clicar e reiniciar na hora,
ou ignorar: a atualização é instalada quando você fechar o programa. Ele nunca reinicia sozinho no meio do trabalho, e
uma aba com texto não salvo continua perguntando antes de fechar.

Funciona no Windows (o instalado com `Tyto-Setup`) e no Linux. Na versão do Windows que roda sem instalar e no Mac, o
rodapé mostra **"Versão X disponível — Baixar"**, com um link para esta página, e você instala na mão. No Mac é porque a
atualização automática exige o app assinado, e o Tyto ainda não tem certificado. Sem internet, o Tyto abre normalmente
e só deixa de procurar.

**Senha ou chave de um plugin pela janela.** Na tela de plugins, cada chave que um plugin pede aparece com a situação
(preenchida ou não), um campo para digitar, Salvar e Apagar. O valor fica guardado no cofre do sistema e nunca volta a
aparecer na tela.

**Avisos mais claros na entrega.** Quando já existe um arquivo com o nome de uma pasta que a exportação precisa criar, ou
uma pasta com o nome de um arquivo que ela precisa gravar, o Tyto diz qual caminho está ocupado e o que fazer, em vez de
mostrar um erro técnico.

**Seleção visível na linha do cursor.** Selecionar um trecho dentro da linha onde está o cursor (com o mouse, ou com `V`
e `Ctrl+V` no modo vim) agora aparece. Antes, a seleção ficava escondida embaixo do destaque da linha.

**Mais proteção no programa instalado.** O executável do Tyto não pode mais ser usado por outro programa do computador
como um Node comum, nem para ligar um depurador. No Windows, um programa alterado depois de instalado se recusa a abrir.
Um desenho SVG embutido num template agora só é aceito se tiver formas simples; um SVG com estilo interno, degradê, texto
ou imagem é recusado com um aviso dizendo como converter.

## O que ela ainda não faz

**Quem tem a 0.6.0 precisa baixar esta na mão, uma vez.** A 0.6.0 não tinha o atualizador.

**O instalador não é assinado.** Na primeira vez que você abrir:

- **Windows**: o SmartScreen mostra "O Windows protegeu o computador". Clique em **Mais informações** e depois em
  **Executar assim mesmo**. Isso é esperado: quer dizer que o arquivo não tem certificado pago, não que ele esteja
  infectado.
- **macOS**: o Gatekeeper recusa na primeira tentativa. Clique com o botão direito no aplicativo, escolha **Abrir** e
  confirme.

**No Mac, só Apple Silicon (M1 em diante).** Um Mac com processador Intel baixa um arquivo que não abre. Se for o seu
caso, me avise antes de baixar.

**Plugins só se instalam pela linha de comando** (`tyto plugin install`). A tela de plugins mostra o que está instalado
e guarda as chaves, mas ainda não instala nem remove nada.

## Se alguma coisa der errado

Me mande a pasta do log:

- Com a janela aberta: menu **Ajuda ▸ Abrir a pasta do log**.
- Se nem abriu: no Windows, cole `%APPDATA%\Tyto\0.7.0\logs` na barra do Explorador de Arquivos; no Mac,
  `~/Library/Application Support/Tyto/0.7.0/logs`; no Linux, `~/.config/Tyto/0.7.0/logs`.

Na primeira vez que a 0.7.0 abrir, ela oferece trazer da 0.6.0 a pasta de templates, a arrumação dos painéis e os
arquivos recentes, como na versão anterior.

## O que baixar

Os nomes abaixo são os dos arquivos como eles aparecem na página.

| Sistema               | Arquivo                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| Windows, instalando   | `Tyto-Setup-0.7.0.exe` (este se atualiza sozinho daqui em diante)          |
| Windows, sem instalar | `Tyto-0.7.0.exe`: um arquivo só, roda de onde estiver, serve para pendrive |
| macOS (Apple Silicon) | `Tyto-0.7.0-arm64.dmg`                                                     |
| Linux                 | `Tyto-0.7.0.AppImage`: dê permissão de execução e rode                     |

Os arquivos `.blockmap` e `latest*.yml` que aparecem na lista não são para você: são do mecanismo de atualização
automática. Ignore.
