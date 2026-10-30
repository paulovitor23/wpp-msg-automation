const reading = document.querySelector('#reading');
const title = document.querySelector('#title');
const message = document.querySelector('#message');
const date = document.querySelector('#date');
const status = document.querySelector('#status');
const notice = document.querySelector('#notice');
const copy = document.querySelector('#copy');
const reload = document.querySelector('#reload');
const copyLabel = document.querySelector('#copy-label');
const reloadLabel = document.querySelector('#reload-label');
let current;
let copying = false;
let loading = false;

function updateActions() {
  copy.disabled = !current || copying || loading;
  reload.disabled = copying || loading;
  reloadLabel.textContent = loading ? 'Atualizando…' : 'Atualizar';
}
function showNotice(text = '') {
  notice.textContent = text;
  notice.hidden = !text;
}
async function load() {
  if (loading || copying) return;
  loading = true;
  updateActions();
  reading.setAttribute('aria-busy', 'true');
  copyLabel.textContent = 'Copiar frase';
  status.textContent = 'Buscando a frase…';
  try {
    const response = await fetch('/api/phrase', { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Não foi possível atualizar a frase. Tente novamente em instantes.');
    const data = await response.json();
    if (data) {
      // Never place unexpected provider content or HTML into the page.
      if (typeof data.title !== 'string' || typeof data.message !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.editionDate)) throw new Error('A frase recebida está incompleta. Tente atualizar novamente.');
      const parsedDate = new Date(`${data.editionDate}T12:00:00Z`);
      if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== data.editionDate) throw new Error('A data da frase é inválida. Tente atualizar novamente.');
      current = data;
      title.textContent = data.title;
      message.textContent = data.message;
      date.textContent = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full', timeZone: 'UTC' }).format(parsedDate);
      date.setAttribute('datetime', data.editionDate);
      showNotice(typeof data.notice === 'string' ? data.notice : '');
      status.textContent = 'Frase atualizada.';
    } else if (current) {
      status.textContent = 'Nenhuma edição nova disponível. Mantivemos a frase que você estava lendo.';
    } else {
      title.textContent = 'A inspiração já vem.';
      message.textContent = 'A edição de hoje ainda não foi encontrada. Volte daqui a pouco.';
      date.textContent = 'AGUARDANDO A EDIÇÃO DE HOJE';
      date.removeAttribute('datetime');
      showNotice();
      status.textContent = 'Você pode tentar atualizar em instantes.';
    }
  } catch (error) {
    if (!current) {
      title.textContent = 'Uma pequena pausa.';
      message.textContent = 'Não conseguimos buscar a frase agora.';
      date.textContent = 'FRASE DO DIA';
      date.removeAttribute('datetime');
    }
    status.textContent = error.name === 'TimeoutError' ? 'A busca demorou mais que o esperado. Tente novamente em instantes.' : error.message;
    if (current) status.textContent += ' A frase anterior continua disponível.';
  } finally {
    loading = false;
    reading.setAttribute('aria-busy', 'false');
    updateActions();
  }
}
copy.addEventListener('click', async () => {
  if (!current || copying || loading) return;
  copying = true;
  updateActions();
  try {
    await navigator.clipboard.writeText(`${current.title}\n\n${current.message}\n\nFonte: the news · ${current.editionDate.split('-').reverse().join('/')}`);
    copyLabel.textContent = 'Copiada!';
    status.textContent = 'Frase copiada. Leve essa ideia com você.';
  } catch { status.textContent = 'Não foi possível copiar. Selecione o texto e copie manualmente.'; }
  finally { copying = false; updateActions(); }
});
reload.addEventListener('click', load);
load();
