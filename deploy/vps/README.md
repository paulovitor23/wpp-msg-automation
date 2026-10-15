# VPS — preparação para Ubuntu 24.04 LTS

Arquivos preparados; nenhum servidor foi criado ou configurado. A instalação deve ser feita após confirmar a VM e o acesso SSH. Para Oracle Free Tier, escolha somente recursos marcados Always Free e confira os limites da conta e o custo estimado antes de criar. Disponibilidade de capacidade não é garantida.

## Estrutura no servidor

- Node.js 24 LTS instalado em `/usr/local/bin/node` (confirmar antes de instalar as unidades).
- Usuário de sistema `agoniados`, sem login interativo.
- Código e dependências Linux em `/opt/agoniados`; não copie `node_modules` do Mac.
- `.env` e `data/token.json` com acesso restrito ao usuário do serviço.
- SQLite persistente em `/opt/agoniados/data/history.sqlite`.
- Porta 3000 restrita a loopback. A página inicialmente é acessada por túnel SSH, sem exposição pública.

## Preparação após contratar/criar a VM

1. Confirmar imagem Ubuntu, arquitetura e IP. Acesso SSH por chave; nunca compartilhar chave privada ou senha no chat.
2. Instalar atualizações e Node 24 LTS para a arquitetura correta, conferindo checksum do download oficial. Configurar sincronização do relógio.
3. Criar o usuário `agoniados` e `/opt/agoniados`. Enviar código sem `.git`, `.env`, `data` ou `node_modules`.
4. Instalar dependências no Linux com `PUPPETEER_SKIP_DOWNLOAD=true npm ci --include=dev` (tsx é necessário para executar o projeto). Esse deploy é de página + e-mail, sem navegador WhatsApp.
5. Autorizar Gmail localmente com `npm run email:auth`. Transferir `.env` e `data/token.json` por SSH; a credencial Desktop completa não é necessária para operação não interativa.
6. Parar o agendador local antes da migração. Se houver histórico, transferir uma cópia consistente do SQLite com todos os processos que escrevem nele parados. Não operar dois agendadores com bancos separados.
7. Manter código de propriedade administrativa, legível pelo serviço; apenas `data` gravável pelo usuário `agoniados`. `.env` pode ser root:agoniados com modo 640 e token modo 600, pertencente a agoniados.
8. Testar como o usuário do serviço: leitura da frase e verificação do escopo de envio, sem disparar e-mails. Executar os testes e a verificação TypeScript.
9. Instalar as unidades abaixo e confirmar o próximo horário antes de ativar o timer.

## Instalação das unidades (na VPS)

```sh
sudo install -m 644 deploy/vps/agoniados-web.service /etc/systemd/system/
sudo install -m 644 deploy/vps/agoniados-email.service /etc/systemd/system/
sudo install -m 644 deploy/vps/agoniados-email.timer /etc/systemd/system/
sudo systemd-analyze verify /etc/systemd/system/agoniados-web.service /etc/systemd/system/agoniados-email.service /etc/systemd/system/agoniados-email.timer
sudo systemctl daemon-reload
sudo systemctl enable --now agoniados-web.service
sudo systemctl enable --now agoniados-email.timer
systemctl list-timers agoniados-email.timer
```

O timer envia e-mails reais às 06:10. Não execute `npm start` em paralelo; na VPS o systemd substitui o loop do agendador. `Persistent=false` mantém o comportamento atual: não recupera envios perdidos durante desligamento. Falhas de envio não reiniciam o lote automaticamente. Uma execução interrompida pode exigir revisão dos destinatários com estado incerto.

Para acessar a página do seu computador (substitua os marcadores):

```sh
ssh -N -L 3001:127.0.0.1:3000 USUARIO@IP_DA_VPS
```

Abra http://127.0.0.1:3001. Os e-mails continuam sendo enviados com seu PC desligado; só o acesso via túnel requer o PC. Publicar a página para seus amigos exige uma etapa separada de acesso e HTTPS.

## Operação

```sh
sudo journalctl -u agoniados-email.service -n 50 --no-pager
sudo journalctl -u agoniados-web.service -n 50 --no-pager
sudo systemctl stop agoniados-email.timer
```

Revisar o timer após reboots e fazer backups consistentes e privados do histórico. Sem o histórico, a proteção contra repetição é perdida. Não restaurar cegamente um banco anterior ao último envio.

Tokens de projetos Google no modo Testing podem expirar em sete dias. Revisar o status OAuth antes de confiar na execução contínua; manter um procedimento de reautorização local e transferência segura. O plano gratuito pode perder capacidade/recursos por políticas do provedor; manter cópia recuperável fora da VM.
