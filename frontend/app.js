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
  status.textContent = 'Buscando a frase no seu e-mail…';
  try {
    const response = await fetch('/api/phrase');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível carregar a frase.');
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
    status.textContent = '';
  } catch (error) {
    title.textContent = 'uma pequena pausa.';
    message.textContent = 'Não conseguimos buscar a frase agora.';
    date.textContent = 'FRASE DO DIA';
    status.textContent = error.message;
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
