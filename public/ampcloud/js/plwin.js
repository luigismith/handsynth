// Playlist editor: the play queue. Numbered rows, selection, drag to reorder,
// ADD / REM / SEL / MISC / LIST menus, shared playlists saved in the cloud.
import { h, showMenu, fmtTime, promptBox, confirmBox, toast } from './ui.js?v=1.1.0';

export function createPlaylistWindow(app) {
  const list = h('div', { class: 'pl-list', tabindex: '0', role: 'listbox', 'aria-label': 'Playlist' });
  const totals = h('div', { class: 'pl-totals' });
  const mini = h('div', { class: 'pl-mini' });
  const menuBtn = (label, items) =>
    h('button', { class: 'b pl-btn', text: label, onclick: (e) => showMenu(items(), e.currentTarget) });

  const sel = new Set();
  let anchor = -1;

  const el = h(
    'section',
    { class: 'win plwin', id: 'w-pl', 'aria-label': 'Playlist' },
    h(
      'div',
      { class: 'titlebar' },
      h('span', { class: 'title-text', text: `${app.appName.toUpperCase()} PLAYLIST` }),
      h('button', { class: 'b tb-shade', title: 'Riduci', onclick: () => app.wm.toggleShade('pl') }),
      h('button', { class: 'b tb-close', title: 'Chiudi', onclick: () => app.wm.toggle('pl', false) }),
    ),
    list,
    h(
      'div',
      { class: 'pl-bottom' },
      menuBtn('ADD', () => [
        { label: 'Brani selezionati in libreria', action: () => app.enqueue(app.librarySelection()) },
        { label: 'Tutta la libreria', action: () => app.enqueue(app.visibleLibrary().map((t) => t.id)) },
        '-',
        { label: 'Carica nuovi brani dal computer…', action: () => app.pickFiles() },
      ]),
      menuBtn('REM', () => [
        { label: 'Rimuovi selezionati', hint: 'Canc', action: removeSelected, disabled: !sel.size },
        { label: 'Rimuovi tutti gli altri', action: cropSelected, disabled: !sel.size },
        { label: 'Svuota playlist', action: () => (clearSel(), app.setPlaylist([], -1)) },
      ]),
      menuBtn('SEL', () => [
        { label: 'Seleziona tutto', hint: 'Ctrl+A', action: selectAll },
        { label: 'Nessuno', action: () => (clearSel(), render()) },
        { label: 'Inverti selezione', action: invertSel },
      ]),
      menuBtn('MISC', () => [
        { label: 'Ordina per titolo', action: () => sortBy((t) => t.title) },
        { label: 'Ordina per artista', action: () => sortBy((t) => `${t.artist} ${t.title}`) },
        { label: 'Ordina per chi l’ha caricato', action: () => sortBy((t) => `${t.owner} ${t.title}`) },
        { label: 'Mescola', action: shuffleList },
        { label: 'Inverti ordine', action: reverseList },
        '-',
        { label: 'Info brano', action: () => app.showTrackInfo(trackAt([...sel][0] ?? app.index)) },
      ]),
      h('div', { class: 'pl-info' }, totals, mini),
      menuBtn('LIST', listMenu),
    ),
    h('div', { class: 'grip', title: 'Ridimensiona' }),
  );

  const ids = () => app.playlist;
  const trackAt = (i) => app.tracks.get(ids()[i]);
  const clearSel = () => sel.clear();

  function render() {
    const frag = document.createDocumentFragment();
    let total = 0;
    ids().forEach((id, i) => {
      const t = app.tracks.get(id);
      if (!t) return;
      total += t.duration;
      const row = h(
        'div',
        {
          class: `pl-row${i === app.index ? ' current' : ''}${sel.has(i) ? ' sel' : ''}`,
          role: 'option',
          'aria-selected': sel.has(i) ? 'true' : 'false',
          draggable: 'true',
          'data-i': i,
        },
        h('span', { class: 'pl-name', text: `${i + 1}. ${t.artist ? `${t.artist} - ` : ''}${t.title}` }),
        h('span', { class: 'pl-dur', text: fmtTime(t.duration) }),
      );
      frag.append(row);
    });
    if (!ids().length) {
      frag.append(
        h(
          'div',
          { class: 'pl-empty' },
          'Playlist vuota.',
          h('br'),
          matchMedia('(pointer: coarse)').matches
            ? 'Tocca un brano nella libreria condivisa per ascoltarlo.'
            : 'Doppio clic su un brano della libreria, oppure trascina qui i tuoi file audio per caricarli.',
        ),
      );
    }
    list.replaceChildren(frag);
    const selTotal = [...sel].reduce((s, i) => s + (trackAt(i)?.duration || 0), 0);
    totals.textContent = `${fmtTime(selTotal)}/${fmtTime(total)}`;
  }

  // selection changes only toggle classes: rebuilding rows would break double-click
  function paintSel() {
    for (const row of list.children) {
      if (row.dataset.i === undefined) continue;
      const on = sel.has(Number(row.dataset.i));
      row.classList.toggle('sel', on);
      row.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    const selTotal = [...sel].reduce((s, i) => s + (trackAt(i)?.duration || 0), 0);
    totals.textContent = `${fmtTime(selTotal)}/${totals.textContent.split('/')[1] || '0:00'}`;
  }

  function updateMini() {
    mini.textContent = app.current ? `${fmtTime(app.engine.time)}` : '';
  }
  setInterval(updateMini, 500);

  // ----- selection & activation -----
  let lastPointer = 'mouse';
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.pl-row');
    if (row && lastPointer !== 'mouse') app.playIndex(Number(row.dataset.i));
  });
  list.addEventListener('pointerdown', (e) => {
    lastPointer = e.pointerType;
    const row = e.target.closest('.pl-row');
    if (!row) return;
    const i = Number(row.dataset.i);
    if (e.shiftKey && anchor >= 0) {
      if (!(e.ctrlKey || e.metaKey)) sel.clear();
      for (let k = Math.min(anchor, i); k <= Math.max(anchor, i); k++) sel.add(k);
    } else if (e.ctrlKey || e.metaKey) {
      sel.has(i) ? sel.delete(i) : sel.add(i);
      anchor = i;
    } else if (!sel.has(i)) {
      sel.clear();
      sel.add(i);
      anchor = i;
    }
    paintSel();
  });
  list.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.pl-row');
    if (row) app.playIndex(Number(row.dataset.i));
  });
  list.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.pl-row');
    if (!row) return;
    e.preventDefault();
    const i = Number(row.dataset.i);
    if (!sel.has(i)) {
      sel.clear();
      sel.add(i);
      render();
    }
    showMenu(
      [
        { label: 'Riproduci', action: () => app.playIndex(i) },
        { label: 'Info brano', action: () => app.showTrackInfo(trackAt(i)) },
        { label: 'Scarica', action: () => app.downloadTracks([...sel].sort((a, b) => a - b).map(trackAt)) },
        { label: 'Copia link del brano', action: () => app.copyTrackLink(trackAt(i)) },
        '-',
        { label: 'Rimuovi dalla playlist', action: removeSelected },
      ],
      { x: e.clientX, y: e.clientY },
    );
  });
  list.addEventListener('keydown', (e) => {
    const n = ids().length;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      removeSelected();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      e.stopPropagation();
      selectAll();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const i = [...sel][0];
      if (i !== undefined) app.playIndex(i);
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && n) {
      e.preventDefault();
      e.stopPropagation();
      const cur = anchor >= 0 ? anchor : -1;
      const next = Math.max(0, Math.min(n - 1, cur + (e.key === 'ArrowDown' ? 1 : -1)));
      sel.clear();
      sel.add(next);
      anchor = next;
      render();
      list.querySelector(`[data-i="${next}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  });

  // ----- drag to reorder -----
  let dragFrom = null;
  list.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.pl-row');
    if (!row) return;
    dragFrom = Number(row.dataset.i);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/x-ampcloud-row', String(dragFrom));
  });
  list.addEventListener('dragover', (e) => {
    if (dragFrom === null) return;
    e.preventDefault();
    e.stopPropagation();
    list.querySelectorAll('.drop-before').forEach((r) => r.classList.remove('drop-before'));
    e.target.closest('.pl-row')?.classList.add('drop-before');
  });
  list.addEventListener('drop', (e) => {
    if (dragFrom === null) return;
    e.preventDefault();
    e.stopPropagation();
    const row = e.target.closest('.pl-row');
    const to = row ? Number(row.dataset.i) : ids().length;
    const moving = sel.has(dragFrom) ? [...sel].sort((a, b) => a - b) : [dragFrom];
    moveRows(moving, to);
    dragFrom = null;
  });
  list.addEventListener('dragend', () => {
    dragFrom = null;
    list.querySelectorAll('.drop-before').forEach((r) => r.classList.remove('drop-before'));
  });

  function moveRows(rows, to) {
    const list0 = ids().map((id, i) => ({ id, i }));
    const moving = list0.filter((x) => rows.includes(x.i));
    const rest = list0.filter((x) => !rows.includes(x.i));
    const insertAt = rest.findIndex((x) => x.i >= to);
    rest.splice(insertAt < 0 ? rest.length : insertAt, 0, ...moving);
    sel.clear();
    rest.forEach((x, k) => moving.includes(x) && sel.add(k));
    app.setPlaylist(
      rest.map((x) => x.id),
      rest.findIndex((x) => x.i === app.index),
    );
  }

  // ----- edit operations -----
  function removeSelected() {
    if (!sel.size) return;
    const keep = ids().filter((_, i) => !sel.has(i));
    const curIdx = sel.has(app.index) ? -1 : ids().slice(0, app.index + 1).filter((_, i) => !sel.has(i)).length - 1;
    if (sel.has(app.index)) app.stop();
    sel.clear();
    app.setPlaylist(keep, curIdx);
  }
  function cropSelected() {
    const keepIdx = [...sel].sort((a, b) => a - b);
    const keep = keepIdx.map((i) => ids()[i]);
    const curIdx = keepIdx.indexOf(app.index);
    sel.clear();
    app.setPlaylist(keep, curIdx);
  }
  function selectAll() {
    ids().forEach((_, i) => sel.add(i));
    render();
  }
  function invertSel() {
    ids().forEach((_, i) => (sel.has(i) ? sel.delete(i) : sel.add(i)));
    render();
  }
  function reorder(fn) {
    const curId = ids()[app.index];
    const next = fn([...ids()]);
    sel.clear();
    app.setPlaylist(next, app.index >= 0 ? next.indexOf(curId) : -1);
  }
  function sortBy(key) {
    reorder((list0) =>
      list0.sort((a, b) =>
        key(app.tracks.get(a) || {}).localeCompare(key(app.tracks.get(b) || {}), 'it', { sensitivity: 'base' }),
      ),
    );
  }
  function shuffleList() {
    reorder((a) => {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    });
  }
  function reverseList() {
    reorder((a) => a.reverse());
  }

  // ----- shared playlists in the cloud -----
  function listMenu() {
    const pls = app.playlists;
    const mine = pls.filter((p) => p.ownerId === app.user.id || app.user.isAdmin);
    return [
      {
        label: 'Apri playlist condivisa',
        items: pls.map((p) => ({
          label: `${p.name}  (${p.trackIds.length}) — ${p.owner}`,
          action: () => {
            clearSel();
            app.setPlaylist(p.trackIds.filter((id) => app.tracks.has(id)), -1);
            toast(`Playlist “${p.name}” caricata`);
          },
        })),
      },
      {
        label: 'Accoda playlist condivisa',
        items: pls.map((p) => ({ label: p.name, action: () => app.enqueue(p.trackIds) })),
      },
      '-',
      { label: 'Salva come nuova playlist…', action: saveNew, disabled: !ids().length },
      {
        label: 'Sovrascrivi playlist',
        items: mine.map((p) => ({
          label: p.name,
          action: async () => {
            if (!(await confirmBox('Sovrascrivi', `Sostituire il contenuto di “${p.name}” con la playlist attuale?`)))
              return;
            await app.savePlaylist({ id: p.id, name: p.name, trackIds: [...ids()] });
          },
        })),
      },
      {
        label: 'Elimina playlist',
        items: mine.map((p) => ({
          label: p.name,
          action: async () => {
            if (await confirmBox('Elimina playlist', `Eliminare “${p.name}” per tutti?`, 'Elimina'))
              await app.deletePlaylist(p.id);
          },
        })),
      },
      '-',
      { label: 'Aggiorna', action: () => app.refresh() },
    ];
  }
  async function saveNew() {
    const name = await promptBox('Salva playlist', 'Nome (la vedranno tutti gli amici)');
    if (name) await app.savePlaylist({ name: name.slice(0, 80), trackIds: [...ids()] });
  }

  app.on('playlist', () => {
    for (const i of [...sel]) if (i >= ids().length) sel.delete(i);
    render();
  });
  app.on('library', render);
  app.on('track', () => {
    render();
    list.querySelector('.pl-row.current')?.scrollIntoView({ block: 'nearest' });
  });
  render();
  return el;
}
