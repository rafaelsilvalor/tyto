# Sua pasta de templates

Os seus templates ficam numa pasta que você escolhe, com uma subpasta por template. O Tyto procura nela **antes** dos templates que vêm com ele.

## Como escolher

Rode **Escolher pasta de templates…** na barra de comandos e escolha a pasta. A escolha fica guardada na [configuração](../reference/settings.md#templatesfolder) `templatesFolder`, então sobrevive a um reinício. **Voltar aos templates internos** desfaz a escolha. **Ajuda ▸ Sobre o Tyto** mostra qual pasta está em uso.

Na linha de comando, `tyto render --templates <pasta>` faz o mesmo para uma renderização; sem isso, o `tyto` procura uma pasta `templates` na pasta atual.

## O que vai nela

```
Tyto templates/
  notice/
    manifest.yaml
    template.html
  first-card/
    manifest.yaml
    template.html
  formats.yaml        (opcional)
```

Cada subpasta é um template, com o nome que está no `name:` do seu `manifest.yaml`. Uma pasta sem nenhum template aparece no painel de problemas como `E_TEMPLATE_FOLDER_EMPTY`, e os templates internos continuam funcionando.

Um `formats.yaml` ao lado dos templates substitui os tamanhos internos; sem ele, valem os tamanhos internos. [Formatos](../briefs/formats.md) explica o arquivo.

## Rodar os exemplos do manual

Todos os exemplos de [Briefs](../briefs/) são escritos para o `notice`, um template pequeno guardado junto com este manual. Para testar no app:

1. Baixe os dois arquivos do [`notice`](https://github.com/rafaelsilvalor/tyto/tree/main/apps/docs/examples/templates/notice) para uma subpasta `notice` da sua pasta de templates.
2. Copie um exemplo para um brief novo. Os que usam imagem precisam do [`photo.png`](https://github.com/rafaelsilvalor/tyto/tree/main/apps/docs/examples/briefs/photo.png) salvo ao lado do brief.

## Um template com o mesmo nome de um interno

O seu ganha. Um template da sua pasta com o nome de um que vem com o Tyto é o que será usado, e o Tyto avisa uma vez com `W_TEMPLATE_SHADOWED`, citando os dois, para que nunca seja surpresa. Renomeie o seu para manter os dois.
