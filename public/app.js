/* ── State ─────────────────────────────────────────────────── */
let selectedProject = null;

/* ── DOM refs ──────────────────────────────────────────────── */
const searchInput     = document.getElementById('search-input');
const btnSearch       = document.getElementById('btn-search');
const searchStatus    = document.getElementById('search-status');
const resultsWrapper  = document.getElementById('results-wrapper');
const resultsBody     = document.getElementById('results-body');

const sectionSearch   = document.getElementById('section-search');
const sectionForm     = document.getElementById('section-form');
const sectionConfirm  = document.getElementById('section-confirm');

const selProyecto     = document.getElementById('sel-proyecto');
const selNombre       = document.getElementById('sel-nombre');
const selCliente      = document.getElementById('sel-cliente');
const btnChange       = document.getElementById('btn-change');

const form            = document.getElementById('notification-form');
const pmSelect        = document.getElementById('pm-select');
const causaSelect     = document.getElementById('causa-select');
const montoInput      = document.getElementById('monto-input');
const mesSelect       = document.getElementById('mes-select');
const anioSelect      = document.getElementById('anio-select');
const comentarioInput = document.getElementById('comentario-input');
const charCount       = document.getElementById('char-count');
const formError       = document.getElementById('form-error');
const btnSubmit       = document.getElementById('btn-submit');
const btnSubmitText   = document.getElementById('btn-submit-text');
const btnSubmitLoader = document.getElementById('btn-submit-loader');

const confirmDetail   = document.getElementById('confirm-detail');
const btnNueva        = document.getElementById('btn-nueva');
const footerYear      = document.getElementById('footer-year');

/* ── Init ──────────────────────────────────────────────────── */
footerYear.textContent = new Date().getFullYear();

// Populate year dropdown (current year + next 3)
const currentYear = new Date().getFullYear();
for (let y = currentYear; y <= currentYear + 3; y++) {
  const opt = document.createElement('option');
  opt.value = y;
  opt.textContent = y;
  anioSelect.appendChild(opt);
}

/* ── Search ────────────────────────────────────────────────── */
btnSearch.addEventListener('click', doSearch);
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

async function doSearch() {
  const q = searchInput.value.trim();
  if (!q) {
    showStatus('Escribe al menos un carácter para buscar.');
    return;
  }

  showStatus('Buscando...');
  resultsWrapper.classList.add('hidden');
  btnSearch.disabled = true;

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) throw new Error(`Error del servidor: ${res.status}`);
    const rows = await res.json();

    if (rows.error) throw new Error(rows.error);

    if (rows.length === 0) {
      showStatus('No se encontraron proyectos. Intenta con otro término.');
      return;
    }

    renderResults(rows);
    showStatus(`${rows.length} proyecto${rows.length !== 1 ? 's' : ''} encontrado${rows.length !== 1 ? 's' : ''}. Haz clic en uno para seleccionarlo.`);
    resultsWrapper.classList.remove('hidden');

  } catch (err) {
    showStatus(`Error: ${err.message}`);
  } finally {
    btnSearch.disabled = false;
  }
}

function showStatus(msg) {
  searchStatus.textContent = msg;
  searchStatus.classList.remove('hidden');
}

function renderResults(rows) {
  resultsBody.innerHTML = '';
  rows.forEach(row => {
    const tr = document.createElement('tr');
    tr.dataset.proyecto     = row.proyecto      || '';
    tr.dataset.nombre       = row.nombre        || '';
    tr.dataset.nombreclient = row.nombre_cliente || '';
    tr.dataset.pm           = row.pm            || '';
    tr.dataset.moneda       = row.moneda        || '';

    tr.innerHTML = `
      <td>${esc(row.proyecto)}</td>
      <td>${esc(row.nombre)}</td>
      <td>${esc(row.nombre_cliente)}</td>
      <td>${esc(row.pm)}</td>
      <td><span class="moneda-badge moneda-${(row.moneda||'').toLowerCase()}">${esc(row.moneda)}</span></td>
    `;
    tr.addEventListener('click', () => selectProject(tr));
    resultsBody.appendChild(tr);
  });
}

function selectProject(tr) {
  resultsBody.querySelectorAll('tr.selected').forEach(r => r.classList.remove('selected'));
  tr.classList.add('selected');

  selectedProject = {
    proyecto:      tr.dataset.proyecto,
    nombre:        tr.dataset.nombre,
    nombreCliente: tr.dataset.nombreclient,
    pm:            tr.dataset.pm,
    moneda:        tr.dataset.moneda,
  };

  selProyecto.textContent = selectedProject.proyecto;
  selNombre.textContent   = selectedProject.nombre ? `· ${selectedProject.nombre}` : '';
  selCliente.textContent  = selectedProject.nombreCliente ? `· ${selectedProject.nombreCliente}` : '';

  sectionForm.classList.remove('hidden');
  sectionForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ── Change project link ───────────────────────────────────── */
btnChange.addEventListener('click', () => {
  sectionForm.classList.add('hidden');
  sectionSearch.scrollIntoView({ behavior: 'smooth', block: 'start' });
  searchInput.focus();
});

/* ── Char counter ──────────────────────────────────────────── */
comentarioInput.addEventListener('input', () => {
  const len = comentarioInput.value.length;
  charCount.textContent = `${len} / 1000`;
  if (len > 1000) {
    comentarioInput.value = comentarioInput.value.slice(0, 1000);
    charCount.textContent = '1000 / 1000';
  }
});

/* ── Form submit ───────────────────────────────────────────── */
form.addEventListener('submit', async e => {
  e.preventDefault();
  formError.classList.add('hidden');
  clearInvalid();

  if (!selectedProject) {
    showFormError('Selecciona un proyecto de la búsqueda.');
    return;
  }

  const pmOption = pmSelect.options[pmSelect.selectedIndex];
  const pmEmail  = pmSelect.value;
  const pmNombre = pmOption?.dataset?.name || '';

  const causa     = causaSelect.value;
  const monto     = montoInput.value.trim();
  const nuevoMes  = mesSelect.value;
  const nuevoAnio = anioSelect.value;
  const comentario = comentarioInput.value.trim();

  let valid = true;
  if (!pmEmail)    { markInvalid(pmSelect);       valid = false; }
  if (!causa)      { markInvalid(causaSelect);     valid = false; }
  if (!monto || isNaN(parseFloat(monto)) || parseFloat(monto) <= 0) {
                     markInvalid(montoInput);      valid = false; }
  if (!nuevoMes)   { markInvalid(mesSelect);       valid = false; }
  if (!nuevoAnio)  { markInvalid(anioSelect);      valid = false; }
  if (!comentario) { markInvalid(comentarioInput); valid = false; }

  if (!valid) {
    showFormError('Por favor completa todos los campos requeridos.');
    return;
  }

  const payload = {
    proyecto:      selectedProject.proyecto,
    nombre:        selectedProject.nombre,
    nombreCliente: selectedProject.nombreCliente,
    moneda:        selectedProject.moneda,
    pmNombre,
    pmEmail,
    causa,
    monto:     parseFloat(monto),
    nuevoMes:  parseInt(nuevoMes, 10),
    nuevoAnio: parseInt(nuevoAnio, 10),
    comentario,
  };

  setLoading(true);

  try {
    const res = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || `Error ${res.status}`);
    }

    const MONTHS = ['', 'Enero','Febrero','Marzo','Abril','Mayo','Junio',
                    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    confirmDetail.textContent =
      `Proyecto ${payload.proyecto} registrado. Nueva fecha: ${MONTHS[payload.nuevoMes]} ${payload.nuevoAnio}. ` +
      `Se enviaron correos a todos los involucrados.`;

    sectionSearch.classList.add('hidden');
    sectionForm.classList.add('hidden');
    sectionConfirm.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });

  } catch (err) {
    showFormError(`No se pudo enviar la notificación: ${err.message}`);
  } finally {
    setLoading(false);
  }
});

/* ── Nueva notificación ────────────────────────────────────── */
btnNueva.addEventListener('click', () => {
  selectedProject = null;
  form.reset();
  charCount.textContent = '0 / 1000';
  formError.classList.add('hidden');
  resultsWrapper.classList.add('hidden');
  searchStatus.classList.add('hidden');
  searchInput.value = '';
  sectionConfirm.classList.add('hidden');
  sectionForm.classList.add('hidden');
  sectionSearch.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

/* ── Helpers ───────────────────────────────────────────────── */
function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function showFormError(msg) {
  formError.textContent = msg;
  formError.classList.remove('hidden');
  formError.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function markInvalid(el) { el.classList.add('invalid'); }
function clearInvalid() {
  [pmSelect, causaSelect, montoInput, mesSelect, anioSelect, comentarioInput]
    .forEach(el => el.classList.remove('invalid'));
}
function setLoading(on) {
  btnSubmit.disabled = on;
  btnSubmitText.textContent = on ? 'Enviando...' : 'Enviar Notificación';
  btnSubmitLoader.classList.toggle('hidden', !on);
}
