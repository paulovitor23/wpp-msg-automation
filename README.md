# wpp-msg-automation
A Node.js automation that extracts the daily motivational message from the news newsletter in Gmail and shares it with a WhatsApp group.

# the-news-daily

Extrai localmente a mensagem motivacional de uma newsletter do **the news** salva como `.eml`. Esta primeira etapa não conecta ao Gmail nem ao WhatsApp, não envia mensagens e não baixa imagens ou links do e-mail.

## Instalação

Requer Node.js 22.12 ou superior e npm.

```sh
npm ci
```

## Uso

```sh
npm run extract -- "/caminho/newsletter.eml"
npm run extract -- "/caminho/newsletter.eml" --json
npm run extract -- "/caminho/newsletter.eml" --expected-date 2026-10-02
```

A saída padrão mostra título, parágrafo e fonte com a data. `--json` retorna `title`, `message` e `editionDate` (YYYY-MM-DD). Para redirecionar apenas o JSON, use `npm run --silent extract -- ... --json`.

Arquivos antigos são aceitos na extração local; a comparação da data é opcional e explícita. Na futura automação diária, o fluxo deverá fornecer a data esperada no fuso configurado.

## Regras da primeira versão

- MIME e codificações do e-mail são lidos com MailParser; o HTML é analisado com Cheerio, sem executá-lo.
- Exige um único parágrafo iniciado por “bom dia” antes da primeira data da edição.
- Exige um título HTML imediatamente anterior ao parágrafo e apenas separadores entre o parágrafo e a data.
- Valida a data de calendário, título de até 160 caracteres e parágrafo de 30 a 1.500 caracteres.
- Rejeita conteúdo com QUICK TAKES, estrutura alterada, HTML ausente ou arquivos acima de 10 MB.
- Erros são escritos na saída de erro e o processo termina com código 1, sem mensagem parcial.

Essas regras foram baseadas em uma edição real. Ainda é necessário conferir outras edições: alterações no padrão devem gerar revisão das regras, não uma extração por adivinhação. A extração não autentica o remetente; isso pertence à futura integração com o Gmail.

## Verificação

```sh
npm test
npm run typecheck
```

Os testes usam conteúdo sintético e verificam MIME multipart, base64, quoted-printable, entidades HTML, datas e recusa de formatos inesperados. O e-mail original não é incluído no projeto. Arquivos `.eml`, credenciais e dados locais são ignorados pelo Git (a pasta de fixtures é reservada exclusivamente a amostras sanitizadas).

## Próximas etapas

Integração Gmail, agendamento, histórico de envios e conexão WhatsApp serão módulos separados. Nenhuma dessas etapas está implementada nesta versão.

Referências das bibliotecas: [MailParser](https://nodemailer.com/extras/mailparser) e [Cheerio](https://cheerio.js.org/docs/basics/loading/).
