# wpp-msg-automation

Projeto pessoal em Node.js e TypeScript que extrai a frase inicial da newsletter **the news** no Gmail, mostra uma prévia no terminal ou em uma página local e permite enviá-la manualmente a um grupo do WhatsApp.

O front-end tem visual responsivo inspirado na newsletter. Este projeto não é afiliado ao the news. O agendador e a página não enviam mensagens ao WhatsApp.

## Instalação

Requer **Node.js 22.13 ou superior**, npm e navegador para a autorização inicial do Google. Execute os comandos na raiz do projeto.

```sh
npm ci
```

Copie `.env.example` para `.env` se ainda não tiver esse arquivo, preservando configurações existentes. Configure o Gmail conforme a seção abaixo; depois, para abrir a página:

```sh
npm run gmail:auth
npm run web
```

Acesse [http://127.0.0.1:3000](http://127.0.0.1:3000). Mantenha o terminal aberto; use Ctrl+C para parar.

## Comandos

| Comando | O que faz |
| --- | --- |
| `npm run web` | Abre o servidor da página local da frase do dia. |
| `npm run extract -- "/caminho/newsletter.eml"` | Extrai uma frase de um arquivo local, sem acessar contas. |
| `npm run gmail:auth` | Autoriza acesso de leitura ao Gmail pelo navegador. |
| `npm run gmail:preview` | Busca a edição de hoje e mostra a frase no terminal. |
| `npm start` | Mantém o agendamento de prévia ativo. |
| `npm run whatsapp:auth` | Conecta o WhatsApp por QR code e salva a sessão. |
| `npm run whatsapp:groups` | Lista nomes e IDs dos grupos. |
| `npm run whatsapp:send -- --confirm` | Envia de verdade a edição de hoje ao grupo configurado. |
| `npm test` | Executa os testes automatizados. |
| `npm run typecheck` | Verifica os tipos TypeScript. |

## Estrutura

```text
frontend/
  index.html             # Estrutura da landing page
  styles.css             # Visual e adaptação ao celular
  app.js                 # Busca, atualização e cópia da frase
src/
  newsletter/            # Extração e validação do conteúdo
  gmail/                 # Autorização e consultas ao Gmail
  delivery/              # Formatação, WhatsApp e limites de envio
  web/server.ts          # Arquivos públicos e API local da página
  config.ts              # Remetente, fuso e datas
  scheduler.ts           # Horário e histórico de processamento
  main.ts                # Comando de extração local
  gmail-cli.ts           # Comandos Gmail
  whatsapp-cli.ts        # Comandos WhatsApp
  schedule-cli.ts        # Execução contínua do agendador
 tests/                  # Testes com dados e serviços simulados
 data/                   # Credenciais, sessões e SQLite (fora do Git)
 .env.example            # Modelo das variáveis de ambiente
```

## Página da frase do dia


```sh
npm run web
```

Abra http://127.0.0.1:3000 no navegador. A página consulta a edição de hoje no Gmail e exibe título, frase e data, com botões para copiar e atualizar. Há cache de 30 segundos; autentique com `npm run gmail:auth` antes do primeiro uso. Não envia ao WhatsApp e não altera os históricos de processamento/envio.

Organização:

- `frontend/index.html`: estrutura da página.
- `frontend/styles.css`: visual responsivo inspirado na newsletter.
- `frontend/app.js`: carregamento, atualização e cópia da frase.
- `src/web/server.ts`: servidor local e endpoint `/api/phrase`, reutilizando a integração Gmail.
- `tests/web.test.ts`: teste do endpoint e isolamento dos arquivos privados.

Sem framework ou dependência nova. O servidor escuta apenas em `127.0.0.1` e serve uma lista explícita de arquivos públicos; credenciais nunca são servidas. É uma página pessoal local, não um serviço público com autenticação. A referência visual não implica afiliação ao the news.

## Extração local e validação

```sh
npm run extract -- "/caminho/newsletter.eml"
npm run extract -- "/caminho/newsletter.eml" --json
npm run extract -- "/caminho/newsletter.eml" --expected-date 2026-10-02
```

Arquivos antigos são aceitos; a comparação da data é opcional na extração local. A saída JSON contém `title`, `message` e `editionDate`. Use `npm run --silent extract -- ... --json` para omitir o cabeçalho do npm.

O parser aceita a data antes do título ou após o parágrafo inicial. Exige título HTML e parágrafo iniciado por “bom dia”. Quando a data vem antes, exige um separador logo após a frase; quando vem depois, aceita apenas separadores entre o parágrafo e a data. Valida a data, título de até 160 caracteres e parágrafo de 30 a 1.500 caracteres. Rejeita seções posteriores como QUICK TAKES, HTML ausente e arquivos acima de 10 MB. Mudanças no layout podem exigir ajustes; o programa recusa conteúdo inesperado em vez de adivinhar.

## Gmail

A busca combina remetente, dia de recebimento no fuso configurado e data da edição. Não marca e-mails como lidos. O cabeçalho From é conferido, mas isso não constitui autenticação criptográfica do remetente.

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


## Agendamento e histórico

```sh
npm start
```

**O código atual consulta uma vez ao dia, durante o minuto 06:10**, no fuso `TIMEZONE` (padrão `America/Sao_Paulo`). O computador precisa estar ligado, acordado e com o processo rodando. Não instala serviço nem inicia automaticamente com o sistema.

- Se iniciado durante o minuto 06:10, consulta se aquele horário ainda não foi registrado. Fora desse minuto, aguarda o próximo horário diário.
- Não recupera horários perdidos e não repete a busca no mesmo dia após ausência de e-mail ou erro.
- Salva tentativas e edições em `data/history.sqlite`. Uma prévia é **processada**, não **enviada**; os controles são separados.
- Reiniciar preserva o histórico. Uma queda durante a consulta pode deixar `checking`; a próxima tentativa é no dia seguinte.
- O texto é salvo antes de aparecer no terminal. Se houver queda nesse intervalo, consulte manualmente com `gmail:preview`.
- Use uma única caixa, remetente e fuso por banco.

## WhatsApp e envio manual


A integração usa `whatsapp-web.js`, não oficial, sujeita a desconexões e bloqueio de conta. Use o número escolhido para o experimento. Execute um comando WhatsApp por vez, na raiz do projeto.

```sh
npm run whatsapp:auth
```

No celular, abra **WhatsApp → Aparelhos conectados → Conectar aparelho** e escaneie o QR do terminal. O comando encerra quando estiver pronto e preserva a sessão em `data/whatsapp`. A conexão tem limite de três minutos; se expirar, execute novamente. O cache também fica em `data`, fora do Git. Não compartilhe essa pasta.

```sh
npm run whatsapp:groups
```

Lista nomes e IDs dos grupos da conta conectada, sem enviar mensagens. Copie o ID do grupo desejado para o `.env` (crie a partir de `.env.example` se necessário):

```dotenv
WHATSAPP_GROUP_ID=ID_DO_GRUPO@g.us
WHATSAPP_SEND_ENABLED=false
WHATSAPP_CONSENT_CONFIRMED=false
WHATSAPP_MAX_MESSAGE_LENGTH=4096
```

Use o ID completo mostrado pelo comando, sem acrescentar outro sufixo.

Antes do primeiro envio, confirme que todos os participantes autorizaram o recebimento e altere no `.env`:

```dotenv
WHATSAPP_CONSENT_CONFIRMED=true
WHATSAPP_SEND_ENABLED=true
```

O limite de 4.096 caracteres é aplicado antes da chamada ao WhatsApp. Não há tentativas automáticas: qualquer envio com resultado incerto bloqueia novas tentativas até conferência manual.

```sh
npm run whatsapp:send -- --confirm
```

O comando acima exige também a confirmação explícita `--confirm` e envia de verdade: busca e valida a newsletter de hoje no Gmail e envia título, frase e fonte ao grupo configurado. Não precisa esperar o horário do agendamento. A sessão salva é reutilizada; se necessário, aparece outro QR.

O uso de `whatsapp-web.js` é não oficial e pode violar os termos do WhatsApp; não existe garantia de evitar bloqueio, especialmente usando um número pessoal. Para reduzir risco operacional, mantenha somente destinatários com consentimento, envie no máximo uma edição por dia, não faça reenvios automáticos, não use listas de contatos não autorizadas e interrompa o uso se houver aviso, desconexão ou reclamações. Para produção, prefira a WhatsApp Business Platform (API oficial), com modelos e opt-in apropriados.

O histórico `deliveries` em `data/history.sqlite` é separado de `processed`: a prévia não impede o envio. Há bloqueio por grupo + edição e por grupo + e-mail, além de uma tentativa por dia e intervalo mínimo de 24 horas para todo o banco, mesmo trocando de grupo. Qualquer registro `sending` ou `uncertain` pausa todos os novos envios até conferência manual. Antes da chamada de envio, grava `sending`; após retorno com identificador, grava `sent`. Isso não comprova entrega ou leitura dos participantes. Falha ou timeout de 60 segundos grava `uncertain`; queda abrupta pode deixar `sending`. Ambos bloqueiam repetição: confira manualmente o grupo antes de corrigir o registro. Não apague o banco para repetir um teste.

### Dependências do WhatsApp

A auditoria após instalação reportou 9 alertas de severidade alta na árvore do Puppeteer (`basic-ftp` e `extract-zip` e dependentes). `npm audit fix` não resolveu sem propor downgrade do cliente WhatsApp; esse downgrade não foi aplicado. Esses alertas continuam pendentes; testes funcionais não demonstram sua ausência. O navegador mantém seu sandbox padrão.


## Configuração e dados privados

| Variável | Padrão / finalidade |
| --- | --- |
| `NEWSLETTER_SENDER` | `created@thenewscc.com.br` |
| `TIMEZONE` | `America/Sao_Paulo` |
| `WHATSAPP_GROUP_ID` | ID completo do grupo, obtido com `whatsapp:groups`. |
| `WHATSAPP_SEND_ENABLED` | `false`; habilita o envio quando definido como `true`. |
| `WHATSAPP_CONSENT_CONFIRMED` | `false`; registra a confirmação de consentimento dos participantes. |
| `WHATSAPP_MAX_MESSAGE_LENGTH` | `4096`; aceita inteiros de 1 a 4096. |

`.env`, `data/`, credenciais e e-mails locais são ignorados pelo Git. Não publique tokens, sessão do WhatsApp ou a pasta de dados. A pasta de fixtures é uma exceção para amostras sanitizadas, nunca e-mails pessoais completos.

## Verificação

```sh
npm test
npm run typecheck
```

Os testes cobrem extração, consulta simulada do Gmail, agendamento, limites de envio e API web. Não acessam contas reais nem enviam mensagens; o teste web abre uma porta local temporária. O teste visual da página pode usar conteúdo de exemplo; validar contas reais exige suas autorizações.

## Limites atuais

- Envio ao WhatsApp permanece manual; ainda não está ligado ao agendador.
- A página é local e não possui autenticação para publicação na internet.
- O processo precisa permanecer aberto para servir a página ou executar o agendamento.
