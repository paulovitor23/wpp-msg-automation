const reading = document.querySelector('#reading');
const title = document.querySelector('#title');
const message = document.querySelector('#message');
const date = document.querySelector('#date');
const status = document.querySelector('#status');
const copy = document.querySelector('#copy');
const reload = document.querySelector('#reload');
let current;
async function load() {
  reload.disabled = true;
  copy.disabled = true;
  current = undefined;
  reading.setAttribute('aria-busy', 'true');
  status.textContent = 'Buscando a frase…';
  try {
    const response = await fetch('/api/phrase', { signal: AbortSignal.timeout(15000) });
    const data = await response.json();
    if (!response.ok) throw new Error(['auth_error', 'permission_error'].includes(data.code)
      ? 'A conexão com a newsletter precisa de atenção. Avise o responsável pela página.'
      : 'Não foi possível atualizar a frase. Tente novamente em instantes.');
    if (!data) {
      title.textContent = 'a inspiração já vem.';
      message.textContent = 'A edição de hoje ainda não foi encontrada. Volte daqui a pouco.';
      date.textContent = 'AGUARDANDO A EDIÇÃO DE HOJE';
    } else {
      current = data;
      title.textContent = data.title;
      message.textContent = data.message;
      date.textContent = new Intl.DateTimeFormat('pt-BR', {dateStyle:'full',timeZone:'UTC'}).format(new Date(`${data.editionDate}T12:00:00Z`));
      copy.disabled = false;
    }
    status.textContent = data?.notice ?? '';
    if (data) date.setAttribute('datetime', data.editionDate);
    else date.removeAttribute('datetime');
  } catch (error) {
    title.textContent = 'uma pequena pausa.';
    message.textContent = 'Não conseguimos buscar a frase agora.';
    date.textContent = 'FRASE DO DIA';
    date.removeAttribute('datetime');
    status.textContent = error.name === 'TimeoutError' ? 'A busca demorou mais que o esperado. Tente atualizar em instantes.' : error.message;
  } finally {
    reload.disabled = false;
    reading.setAttribute('aria-busy', 'false');
  }
}
copy.addEventListener('click', async () => {
  if (!current) return;
  try {
    await navigator.clipboard.writeText(`${current.title}\n\n${current.message}\n\nFonte: the news · ${current.editionDate.split('-').reverse().join('/')}`);
    status.textContent = 'Frase copiada. Leve essa ideia com você.';
  } catch { status.textContent = 'Não foi possível copiar. Selecione o texto e copie manualmente.'; }
});
reload.addEventListener('click', load);
load();
