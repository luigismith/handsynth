// Shared library window: every track uploaded by the group, searchable and
// sortable. Upload, enqueue, play, edit, delete, copy share link.
import { h, showMenu, fmtTime, confirmBox, dialog, field } from './ui.js?v=1.4.0';

const COLS = [
  { key: 'title', label: 'Titolo' },
  { key: 'artist', label: 'Artista' },
  { key: 'duration', label: 'Durata', num: true },
  { key: 'owner', label: 'Da' },
  { key: 'plays', label: '▶', num: true, title: 'Ascolti' },
];

export function createLibraryWindow(app) {
  const search = h('input', {
    class: 'inp lib-search',
    type: 'search',
    placeholder: 'Cerca titolo, artista, album, amico…',
    'aria-label': 'Cerca nella libreria',
  });
  const filter = h(
    'select',
    { class: 'inp lib-filter', 'aria-label': 'Filtro' },
    h('option', { value: 'all', text: 'Tutti' }),
    h('option', { value: 'mine', text: 'I miei' }),
    h('option', { value: 'new', text: 'Ultimi 7 giorni' }),
  );
  const head = h('div', { class: 'lib-head' });
  const rows = h('div', { class: 'lib-rows', tabindex: '0', role: 'listbox', 'aria-label': 'Brani' });
  const status = h('div', { class: 'lib-status', role: 'status' });
  const btn = (label, title, onClick, cls = '') =>
    h('button', { class: `b lib-btn ${cls}`, text: label, title, onclick: onClick });

  let sortKey = 'createdAt';
  let sortDir = -1;
  const sel = new Set();
  let anchor = null;

  const el = h(
    'section',
    { class: 'win libwin', id: 'w-lib', 'aria-label': 'Libreria condivisa' },
    h(
      'div',
      { class: 'titlebar' },
      h('span', { class: 'title-text', text: `${app.appName.toUpperCase()} LIBRERIA CONDIVISA` }),
      h('button', { class: 'b tb-shade', title: 'Riduci', onclick: () => app.wm.toggleShade('lib') }),
      h('button', { class: 'b tb-close', title: 'Chiudi', onclick: () => app.wm.toggle('lib', false) }),
    ),
    h('div', { class: 'lib-tools' }, search, filter),
    h('div', { class: 'lib-table' }, head, rows),
    h(
      'div',
      { class: 'lib-bottom' },
      btn('+ CARICA', 'Carica brani dal dispositivo o da Google Drive', (e) => app.showUploadMenu(e.currentTarget), 'upload'),
      btn('ACCODA', 'Aggiungi i selezionati alla playlist', () => app.enqueue(selectedIds())),
      btn('▶ PLAY', 'Riproduci subito i selezionati', () => playSelected()),
      btn('…', 'Altre azioni', (e) => showMenu(moreMenu(), e.currentTarget)),
      btn('DUPLICATI', 'Trova ed elimina i brani caricati più volte', () => app.removeDuplicates(), 'dupes'),
      status,
    ),
    h('div', { class: 'grip', title: 'Ridimensiona' }),
  );

  const visible = () => {
    const q = search.value
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
    const week = Date.now() - 7 * 864e5;
    let list = app.library.filter((t) => {
      if (filter.value === 'mine' && t.ownerId !== app.user?.id) return false;
      if (filter.value === 'new' && t.createdAt < week) return false;
      if (!q) return true;
      const hay = `${t.title} ${t.artist} ${t.album} ${t.owner}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
      return q.split(/\s+/).every((w) => hay.includes(w));
    });
    list = [...list].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      const c = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'it', { sensitivity: 'base' });
      return c * sortDir;
    });
    return list;
  };
  app.visibleLibrary = visible;
  app.librarySelection = () => selectedIds();

  const selectedIds = () => visible().filter((t) => sel.has(t.id)).map((t) => t.id);
  const selectedTracks = () => visible().filter((t) => sel.has(t.id));

  function renderHead() {
    head.replaceChildren(
      ...COLS.map((c) =>
        h(
          'button',
          {
            class: `lib-col c-${c.key}${sortKey === c.key ? ' sorted' : ''}`,
            title: c.title || `Ordina per ${c.label.toLowerCase()}`,
            onclick: () => {
              if (sortKey === c.key) sortDir = -sortDir;
              else (sortKey = c.key), (sortDir = c.num ? -1 : 1);
              renderHead();
              render();
            },
          },
          c.label,
          sortKey === c.key ? (sortDir > 0 ? ' ▴' : ' ▾') : '',
        ),
      ),
    );
  }

  function render() {
    const list = visible();
    const frag = document.createDocumentFragment();
    for (const t of list) {
      frag.append(
        h(
          'div',
          {
            class: `lib-row${sel.has(t.id) ? ' sel' : ''}${app.current?.id === t.id ? ' current' : ''}`,
            'data-id': t.id,
            role: 'option',
            'aria-selected': sel.has(t.id) ? 'true' : 'false',
            title: `${t.artist ? `${t.artist} - ` : ''}${t.title}${t.album ? ` [${t.album}]` : ''}\nCaricato da ${t.owner} il ${new Date(t.createdAt).toLocaleDateString('it-IT')}`,
          },
          h('span', { class: 'c-title', text: t.title }),
          h('span', { class: 'c-artist', text: t.artist }),
          h('span', { class: 'c-duration', text: fmtTime(t.duration) }),
          h('span', { class: 'c-owner', text: t.owner }),
          h('span', { class: 'c-plays', text: String(t.plays) }),
        ),
      );
    }
    if (!list.length) {
      frag.append(
        h(
          'div',
          { class: 'pl-empty' },
          app.library.length
            ? 'Nessun brano corrisponde alla ricerca.'
            : 'La libreria è vuota. Premi “+ CARICA” o trascina qui i vostri brani (mp3, flac, wav, ogg, m4a…).',
        ),
      );
    }
    rows.replaceChildren(frag);
    const total = list.reduce((s, t) => s + t.duration, 0);
    if (!app.uploading) status.textContent = `${list.length} brani · ${fmtTime(total)}`;
  }
  // selection changes only toggle classes: rebuilding rows would break double-click
  function paintSel() {
    for (const row of rows.children) {
      if (!row.dataset.id) continue;
      const on = sel.has(row.dataset.id);
      row.classList.toggle('sel', on);
      row.setAttribute('aria-selected', on ? 'true' : 'false');
    }
  }

  app.setLibraryStatus = (text) => {
    status.textContent = text || '';
    if (!text) render();
  };

  function playSelected() {
    const ids = selectedIds();
    if (ids.length) app.playNow(ids);
  }

  function moreMenu() {
    const tracks = selectedTracks();
    const one = tracks.length === 1 ? tracks[0] : null;
    const editable = tracks.length > 0 && tracks.every((t) => app.canEdit(t));
    return [
      { label: tracks.length > 1 ? `Scarica ${tracks.length} brani` : 'Scarica', action: () => app.downloadTracks(tracks), disabled: !tracks.length },
      { label: 'Info brano', action: () => app.showTrackInfo(one), disabled: !one },
      { label: 'Copia link da mandare agli amici', action: () => app.copyTrackLink(one), disabled: !one },
      { label: 'Modifica titolo / artista…', action: () => editTrack(one), disabled: !one || !app.canEdit(one) },
      { label: 'Elimina dal cloud…', action: () => deleteTracks(tracks), disabled: !editable },
      '-',
      { label: 'Seleziona tutto', action: selectAll },
      { label: 'Elimina file duplicati…', action: () => app.removeDuplicates() },
      { label: 'Aggiorna libreria', action: () => app.refresh() },
    ];
  }

  async function editTrack(t) {
    if (!t) return;
    const title = field('Titolo', { value: t.title, maxlength: '200', required: true });
    const artist = field('Artista', { value: t.artist, maxlength: '200' });
    const album = field('Album', { value: t.album, maxlength: '200' });
    await dialog({
      title: 'Modifica brano',
      body: h('div', {}, title, artist, album),
      buttons: [
        { label: 'Annulla', value: null },
        { label: 'Salva', value: 'save', primary: true },
      ],
      onSubmit: async () => {
        const v = (f) => f.querySelector('input').value.trim();
        if (!v(title)) throw new Error('Il titolo non può essere vuoto');
        await app.updateTrack(t.id, { title: v(title), artist: v(artist), album: v(album) });
      },
    });
  }

  async function deleteTracks(tracks) {
    if (!tracks.length) return;
    const msg =
      tracks.length === 1
        ? `Eliminare “${tracks[0].title}” dal cloud? Nessuno potrà più ascoltarlo.`
        : `Eliminare ${tracks.length} brani dal cloud? Nessuno potrà più ascoltarli.`;
    if (!(await confirmBox('Elimina', msg, 'Elimina'))) return;
    for (const t of tracks) await app.deleteTrack(t);
    sel.clear();
  }

  function selectAll() {
    visible().forEach((t) => sel.add(t.id));
    render();
  }

  // ----- interaction -----
  let lastPointer = 'mouse';
  rows.addEventListener('click', (e) => {
    const row = e.target.closest('.lib-row');
    if (row && lastPointer !== 'mouse') app.playNow([row.dataset.id]);
  });
  rows.addEventListener('pointerdown', (e) => {
    lastPointer = e.pointerType;
    const row = e.target.closest('.lib-row');
    if (!row) return;
    const id = row.dataset.id;
    const list = visible().map((t) => t.id);
    if (e.shiftKey && anchor) {
      const a = list.indexOf(anchor);
      const b = list.indexOf(id);
      if (!(e.ctrlKey || e.metaKey)) sel.clear();
      for (let k = Math.min(a, b); k <= Math.max(a, b); k++) sel.add(list[k]);
    } else if (e.ctrlKey || e.metaKey) {
      sel.has(id) ? sel.delete(id) : sel.add(id);
      anchor = id;
    } else if (!sel.has(id) || e.pointerType !== 'mouse') {
      sel.clear();
      sel.add(id);
      anchor = id;
    }
    paintSel();
  });
  rows.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.lib-row');
    if (row) app.playNow([row.dataset.id]);
  });
  rows.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.lib-row');
    if (!row) return;
    e.preventDefault();
    if (!sel.has(row.dataset.id)) {
      sel.clear();
      sel.add(row.dataset.id);
      render();
    }
    showMenu(
      [
        { label: 'Riproduci', action: playSelected },
        { label: 'Accoda alla playlist', action: () => app.enqueue(selectedIds()) },
        '-',
        ...moreMenu(),
      ],
      { x: e.clientX, y: e.clientY },
    );
  });
  rows.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      playSelected();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.size) {
      e.preventDefault();
      e.stopPropagation();
      const t = selectedTracks();
      if (t.every((x) => app.canEdit(x))) deleteTracks(t);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      e.stopPropagation();
      selectAll();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const list = visible().map((t) => t.id);
      if (!list.length) return;
      const cur = anchor ? list.indexOf(anchor) : -1;
      const next = list[Math.max(0, Math.min(list.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1)))];
      sel.clear();
      sel.add(next);
      anchor = next;
      render();
      rows.querySelector(`[data-id="${next}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  });
  search.addEventListener('input', render);
  search.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const first = visible()[0];
      if (first) app.playNow([first.id]);
    }
  });
  filter.addEventListener('change', render);

  app.on('library', render);
  app.on('track', render);
  app.focusSearch = () => {
    app.wm.toggle('lib', true);
    search.focus();
    search.select();
  };
  renderHead();
  render();
  return el;
}
