# Tyto 0.6.0

Tudo o que mudou desde o beta 0.3.0 está aqui, inclusive o que entrou nas 0.4 e 0.5. Continua
sendo um beta: funciona, e o que ainda não funciona está escrito mais abaixo.

## O que há de novo

**Uma fila local de trabalhos.** Em **Arquivo ▸ Mostrar a fila local** você aponta uma pasta.
Cada brief que cair em `inbox/` vira um trabalho, com uma situação visível: pendente,
renderizando, pronto ou com erro. Um trabalho com erro mostra o problema, abre o brief no editor
para você corrigir e pode ser rodado de novo. Com a execução automática ligada (vem desligada),
um brief que cair na pasta é renderizado sozinho. Cada pasta escolhe que tipos de arquivo os
trabalhos dela produzem; quem não escolher continua recebendo só PNG.

**Exportar ficou mais completo.**

- Você escolhe quais formatos sair, em tamanho normal ou em dobro, e quanto comprimir os
  arquivos que perdem qualidade. Sem mexer em nada, sai o mesmo que saía antes.
- A entrega vem organizada: a arte na pasta que você escolheu, o brief em `editaveis/` e as
  imagens que ele usou em `assets/`.
- Os arquivos levam o nome do formato e um número: `grid-01.png`, `grid-02.png`, `story-01.png`.
- Exportar de novo na mesma pasta apaga o que a exportação anterior deixou lá e esta não
  produziu, e avisa o que apagou. Um carrossel que caiu de quatro para três lâminas não deixa
  mais a quarta esquecida na pasta.

**Modo de template.** **Arquivo ▸ Editar template…** abre a pasta de um template com o
manifesto e o HTML em abas próprias e desenha todos os formatos lado a lado, a partir do que está
na tela, antes de salvar. **Arquivo ▸ Novo template…** cria um template do zero.

**Tela de plugins.** **Arquivo ▸ Mostrar plugins** lista os plugins que o programa carregou,
com a situação e as permissões de cada um. Um plugin instalado roda isolado, cada um num processo
próprio e preso à própria pasta para ler e gravar arquivos: se ele quebrar, aparece como quebrado na tela, e o resto do
programa segue. Os templates e os formatos de exportação que um plugin trouxer aparecem no
seletor de templates e na caixa de exportação.

**Fontes da máquina.** Um template pode usar uma fonte instalada no computador. Se ela não
existir na máquina, o Tyto desenha com uma fonte parecida que vem junto e diz isso no painel de
problemas, em vez de sair uma arte com a letra errada sem aviso.

**Tab indenta.** No editor do brief, `Tab` empurra a linha (ou as linhas selecionadas) dois
espaços para a direita, e `Shift+Tab` desfaz. Para sair do editor pelo teclado: `Esc` e depois
`Tab`.

**Cada versão tem a sua pasta de dados.** Uma versão nova não abre mais com as configurações e
os arquivos recentes da anterior misturados. Na primeira vez que você abrir a 0.6.0, ela
oferece, uma vez só, trazer da versão anterior a pasta de templates, a arrumação dos painéis e os
arquivos recentes. Ela copia, nunca move; dizer não fica anotado e ela não pergunta de novo.

**Fechar com abas não salvas** agora oferece **Sim**, **Não** e **Cancelar**, e espera a sua
resposta pelo tempo que for preciso.

## A marca

Os templates que vêm junto desenham um logo e uma assinatura **de exemplo**. A arte de uma marca
de verdade, como o logo e a assinatura, entra por um kit de marca instalado à parte, que não faz
parte deste download.

## O que ela ainda não faz

**Não se atualiza sozinha.** Quando sair uma correção, você baixa o instalador de novo.

**O instalador não é assinado.** Na primeira vez que você abrir:

- **Windows**: o SmartScreen mostra "O Windows protegeu o computador". Clique em **Mais
  informações** e depois em **Executar assim mesmo**. Isso é esperado: quer dizer que o arquivo
  não tem certificado pago, não que ele esteja infectado.
- **macOS**: o Gatekeeper recusa na primeira tentativa. Clique com o botão direito no aplicativo,
  escolha **Abrir** e confirme.

**No Mac, só Apple Silicon (M1 em diante).** Um Mac com processador Intel baixa um arquivo que
não abre. Se for o seu caso, me avise antes de baixar.

**Plugins só se instalam pela linha de comando** (`tyto plugin install`). A tela de plugins
mostra o que está instalado, mas ainda não instala nem remove nada.

## Se alguma coisa der errado

Me mande a pasta do log:

- Com a janela aberta: menu **Ajuda ▸ Abrir a pasta do log**.
- Se nem abriu: no Windows, cole `%APPDATA%\Tyto\0.6.0\logs` na barra do Explorador de Arquivos;
  no Mac, `~/Library/Application Support/Tyto/0.6.0/logs`; no Linux, `~/.config/Tyto/0.6.0/logs`.

A pasta existe desde a primeira vez que o programa abre. Ela tem só o registro de falhas e de
quando o programa abriu: nenhum texto dos seus briefs vai para lá. É a única pasta do programa
que pode ser mandada inteira sem pensar duas vezes.

## O que baixar

Os nomes abaixo são os dos arquivos como eles aparecem na página.

| Sistema               | Arquivo                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| Windows, instalando   | `Tyto-Setup-0.6.0.exe`                                                     |
| Windows, sem instalar | `Tyto-0.6.0.exe`: um arquivo só, roda de onde estiver, serve para pendrive |
| macOS (Apple Silicon) | `Tyto-0.6.0-arm64.dmg`                                                     |
| Linux                 | `Tyto-0.6.0.AppImage`: dê permissão de execução e rode                     |

Os arquivos `.blockmap` e `latest*.yml` que aparecem na lista não são para você: são do mecanismo
de atualização automática, que ainda não está ligado. Ignore.
