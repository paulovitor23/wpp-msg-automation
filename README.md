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

A integração Gmail em modo de prévia está implementada (instruções abaixo). Agendamento, histórico de envios e conexão WhatsApp continuam pendentes.

Referências das bibliotecas: [MailParser](https://nodemailer.com/extras/mailparser) e [Cheerio](https://cheerio.js.org/docs/basics/loading/).

## Etapa 2 — Gmail em modo de prévia

A integração lê o Gmail com a API oficial, busca mensagens recebidas no dia em `America/Sao_Paulo`, confere o endereço do remetente e aplica a validação da edição. Não marca mensagens como lidas nem envia mensagens. Cada execução faz uma única consulta completa (com paginação); o agendamento e o histórico continuam pendentes.

### Configuração do Google (uma vez)

1. Crie ou selecione um projeto no [Google Cloud Console](https://console.cloud.google.com/).
2. Ative a **Gmail API** nesse projeto.
3. Configure o **Google Auth Platform**: para Gmail pessoal, use público **External**, mantenha em teste e adicione seu próprio Gmail aos usuários de teste.
4. Em acesso a dados, configure o escopo `https://www.googleapis.com/auth/gmail.readonly`.
5. Em **Clients**, crie um cliente OAuth do tipo **Desktop app** e baixe o JSON.
6. Crie a pasta `data` na raiz do projeto e salve o JSON como `data/credentials.json`. Não cole esse arquivo no chat ou no GitHub.
7. Opcionalmente, copie `.env.example` para `.env` para mudar remetente ou fuso. O padrão foi obtido do e-mail fornecido: `created@thenewscc.com.br`.
8. No terminal, dentro da pasta do projeto, execute:

```sh
npm run gmail:auth
```

O navegador abre a autorização do Google. Confirme a conta e o acesso de leitura. A permissão é para ler a caixa de e-mail, não apenas a newsletter; o filtro é aplicado pelo nosso programa. O token é salvo em `data/token.json` com acesso restrito ao usuário local. Ambos os arquivos estão ignorados pelo Git.

### Buscar e mostrar a newsletter

```sh
npm run gmail:preview
npm run gmail:preview -- --date 2026-10-02
npm run gmail:preview -- --json
```

Sem `--date`, usa o dia atual no fuso configurado. Com `--date`, exige tanto recebimento quanto data da edição naquele dia. JSON retorna `{ gmailId, newsletter }` ou `null` quando nada é encontrado. Para JSON sem o cabeçalho do npm, use `npm run --silent gmail:preview -- --json`.

Nenhum resultado é normal antes da entrega da newsletter. Formato inválido, duas edições válidas ou erro da API interrompem a prévia com código 1. A verificação do cabeçalho From não constitui autenticação criptográfica do remetente.

### Autorização e limites desta etapa

- Em projetos OAuth externos no modo de teste, o refresh token com acesso ao Gmail normalmente expira em sete dias. Nesse caso, execute `npm run gmail:auth` novamente. Antes de operação contínua, será necessário revisar a configuração OAuth.
- Se a API estiver desativada, ative-a no mesmo projeto das credenciais. Se o acesso for negado, confira o usuário de teste e a conta selecionada.
- A autenticação inicial precisa rodar localmente com navegador. A consulta posterior reutiliza a autorização e não abre o navegador.
- Testes automatizados simulam a API. A validação ponta a ponta exige suas credenciais e consentimento, que não acompanham o repositório.

Referências: [Quickstart oficial Gmail](https://developers.google.com/workspace/gmail/api/quickstart/nodejs), [filtros de busca](https://developers.google.com/workspace/gmail/api/guides/filtering) e [expiração de tokens OAuth](https://developers.google.com/identity/protocols/oauth2#expiration).
