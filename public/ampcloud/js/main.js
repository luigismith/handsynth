// AmpCloud bootstrap and app controller: configuration, login, playback
// queue, uploads, keyboard shortcuts, menus and lock-screen controls.
import { Backend, FORMATS } from './backend.js';
import { Engine } from './engine.js';
import { readTags } from './tags.js';
import {
  $,
  h,
  WindowManager,
  showMenu,
  dialog,
  field,
  alertBox,
  confirmBox,
  promptBox,
  toast,
  store,
  fmtTime,
} from './ui.js';
import { createMainWindow } from './mainwin.js';
import { createEqWindow } from './eqwin.js';
import { createPlaylistWindow } from './plwin.js';
import { createLibraryWindow } from './libwin.js';

const VERSION = '1.0.0';
const b64 = {
  enc: (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))))),
};

// ---------------------------------------------------------------------------
// Configuration: config.js (committed) → overridden by the browser's saved
// config → overridden by an invite link (#invito=...)
// ---------------------------------------------------------------------------
function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const out = { track: params.get('brano') };
  const inv = params.get('invito');
  if (inv) {
    try {
      const v = b64.dec(inv);
      out.invite = { url: v.u, key: v.k, code: v.i || '' };
    } catch {
      console.warn('Link invito non valido');
    }
  }
  return out;
}

function loadConfig(hash) {
  const base = window.AMPCLOUD_CONFIG || {};
  const saved = store.get('config', null);
  let cfg = {
    appName: base.appName || 'AmpCloud',
    url: base.supabaseUrl || '',
    key: base.supabaseAnonKey || '',
  };
  if (saved?.url && saved?.key && !(cfg.url && cfg.key)) cfg = { ...cfg, url: saved.url, key: saved.key };
  if (hash.invite?.url && hash.invite?.key) {
    cfg = { ...cfg, url: hash.invite.url, key: hash.invite.key };
    if (!(base.supabaseUrl && base.supabaseAnonKey)) store.set('config', { url: cfg.url, key: cfg.key });
  }
  return cfg;
}

async function setupDialog(cfg) {
  const url = field('URL del progetto Supabase', {
    value: cfg.url,
    placeholder: 'https://xxxxxxxx.supabase.co',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const key = field('Chiave pubblica (anon / publishable key)', {
    value: cfg.key,
    placeholder: 'eyJhbGciOi… oppure sb_publishable_…',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  await dialog({
    title: 'CONFIGURAZIONE',
    dismissable: false,
    body: h(
      'div',
      {},
      h(
        'p',
        { class: 'dlg-text' },
        'Il sito salva brani e account su un progetto Supabase (gratuito). Se hai ricevuto un link invito, aprilo e questo passo viene saltato. Istruzioni complete: ',
        h('a', { href: 'https://github.com/luigismith/handsynth/blob/main/public/ampcloud/README.md', target: '_blank', rel: 'noopener' }, 'README'),
        '.',
      ),
      url,
      key,
    ),
    buttons: [{ label: 'Collega', value: true, primary: true }],
    onSubmit: async () => {
      const u = url.querySelector('input').value.trim().replace(/\/+$/, '');
      const k = key.querySelector('input').value.trim();
      if (!/^https:\/\/[^/]+$/.test(u)) throw new Error('L’URL deve essere tipo https://xxxx.supabase.co');
      if (k.length < 20) throw new Error('Chiave mancante o troppo corta');
      // reachability + schema check, with the anon role
      const res = await fetch(`${u}/rest/v1/rpc/check_signup`, {
        method: 'POST',
        // only `apikey`: new "sb_publishable_" keys are not JWTs and don't go in Authorization
        headers: { apikey: k, 'Content-Type': 'application/json' },
        body: JSON.stringify({ invite: '', username: '' }),
      }).catch(() => null);
      if (!res) throw new Error('Progetto non raggiungibile: controlla l’URL');
      if (res.status === 401 || res.status === 403) throw new Error('Chiave non valida');
      if (res.status === 404) throw new Error('Database non configurato: esegui schema.sql nell’SQL Editor di Supabase');
      if (!res.ok) throw new Error(`Errore dal server (${res.status})`);
      cfg.url = u;
      cfg.key = k;
      store.set('config', { url: u, key: k });
    },
  });
}

async function loginDialog(backend, cfg, inviteCode) {
  let mode = inviteCode ? 'register' : 'login';
  const email = field('Email', { type: 'email', autocomplete: 'email', required: true });
  const password = field('Password', { type: 'password', autocomplete: 'current-password', required: true, minlength: '6' });
  const username = field('Nome utente (lo vedranno gli amici)', { autocomplete: 'username', maxlength: '24' });
  const invite = field('Codice invito', { value: inviteCode || '', autocomplete: 'off' });
  const extra = h('div', { class: 'register-only' }, username, invite);
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const body = h('div', {}, tabs, email, password, extra);
  const setMode = (m) => {
    mode = m;
    tabs.replaceChildren(
      h('button', { type: 'button', class: `tab${m === 'login' ? ' on' : ''}`, onclick: () => setMode('login'), text: 'Accedi' }),
      h('button', {
        type: 'button',
        class: `tab${m === 'register' ? ' on' : ''}`,
        onclick: () => setMode('register'),
        text: 'Registrati',
      }),
    );
    extra.hidden = m !== 'register';
    password.querySelector('input').autocomplete = m === 'login' ? 'current-password' : 'new-password';
  };
  setMode(mode);

  let user = null;
  await dialog({
    title: `${cfg.appName.toUpperCase()} — ACCESSO`,
    dismissable: false,
    body,
    buttons: [{ label: 'Entra', value: true, primary: true }],
    onSubmit: async () => {
      const v = (f) => f.querySelector('input').value;
      if (!v(email).includes('@')) throw new Error('Inserisci la tua email');
      if (v(password).length < 6) throw new Error('La password deve avere almeno 6 caratteri');
      if (mode === 'login') {
        user = await backend.signIn(v(email), v(password));
      } else {
        if (!v(invite).trim()) throw new Error('Serve il codice invito: chiedilo a chi gestisce il sito');
        const res = await backend.signUp({
          email: v(email),
          password: v(password),
          username: v(username),
          invite: v(invite).trim(),
        });
        if (res.confirm) {
          setMode('login');
          throw new Error('Account creato! Conferma l’email dal link che ti è arrivato, poi accedi qui.');
        }
        user = res.user;
      }
    },
  });
  return user;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
class App {
  constructor(cfg, backend, user) {
    this.cfg = cfg;
    this.appName = cfg.appName;
    this.backend = backend;
    this.user = user;
    this.engine = new Engine();
    this.engine.setVolume(store.get('volume', 0.8));
    this.engine.setBalance(store.get('balance', 0));
    this.library = [];
    this.tracks = new Map();
    this.playlists = [];
    this.playlist = store.get('playlist', []);
    this.index = store.get('index', -1);
    this.current = null;
    this.shuffle = store.get('shuffle', false);
    this.repeat = store.get('repeat', false);
    this.flashText = null;
    this.buffering = false;
    this.history = [];
    this.handlers = {};
    this.counted = false;
  }

  on(ev, fn) {
    (this.handlers[ev] ||= []).push(fn);
  }
  emit(ev) {
    for (const fn of this.handlers[ev] || []) fn();
  }

  flash(text, ms) {
    this.flashText = text;
    clearTimeout(this._flashTimer);
    if (text && ms) this._flashTimer = setTimeout(() => (this.flashText = null), ms);
  }

  marqueeText() {
    if (this.uploading) return this.uploading;
    const t = this.current;
    if (!t) return `${this.appName} ${VERSION} - CIAO ${this.user.username}! - TRASCINA QUI I TUOI BRANI`;
    const pos = this.index >= 0 ? `${this.index + 1}. ` : '';
    return `${pos}${t.artist ? `${t.artist} - ` : ''}${t.title} (${fmtTime(t.duration || this.engine.duration)})`;
  }

  canEdit(t) {
    return Boolean(t) && (t.ownerId === this.user.id || this.user.isAdmin);
  }

  // ----- data -----
  async refresh() {
    try {
      const [lib, pls] = await Promise.all([this.backend.listTracks(), this.backend.listPlaylists()]);
      this.library = lib;
      this.tracks = new Map(lib.map((t) => [t.id, t]));
      this.backend.prefetchUrls(lib).catch(() => {});
      this.playlists = pls;
      const before = this.playlist.length;
      const curId = this.playlist[this.index];
      this.playlist = this.playlist.filter((id) => this.tracks.has(id));
      if (before !== this.playlist.length) this.index = curId ? this.playlist.indexOf(curId) : -1;
      if (this.current) this.current = this.tracks.get(this.current.id) || this.current;
      this.emit('library');
      this.emit('playlist');
    } catch (err) {
      toast(`Impossibile caricare la libreria: ${err.message}`);
    }
  }

  setPlaylist(ids, index = this.index) {
    this.playlist = ids;
    this.index = Math.min(index, ids.length - 1);
    store.set('playlist', ids);
    store.set('index', this.index);
    this.emit('playlist');
  }

  enqueue(ids) {
    const valid = ids.filter((id) => this.tracks.has(id));
    if (!valid.length) return toast('Seleziona prima dei brani nella libreria');
    this.setPlaylist([...this.playlist, ...valid]);
    toast(valid.length === 1 ? 'Aggiunto alla playlist' : `${valid.length} brani aggiunti alla playlist`);
  }

  playNow(ids) {
    const valid = ids.filter((id) => this.tracks.has(id));
    if (!valid.length) return;
    if (valid.length === 1 && this.playlist.includes(valid[0])) return this.playIndex(this.playlist.indexOf(valid[0]));
    const start = this.playlist.length;
    this.setPlaylist([...this.playlist, ...valid]);
    this.playIndex(start);
  }

  // ----- playback -----
  async playIndex(i, { autoplay = true } = {}) {
    const id = this.playlist[i];
    const t = this.tracks.get(id);
    if (!t) return;
    this.index = i;
    store.set('index', i);
    this.current = t;
    this.counted = false;
    if (this.history.at(-1) !== i) this.history.push(i);
    this.emit('track');
    this.updateMediaSession();
    try {
      // With a pre-signed URL, load + play run synchronously inside the tap:
      // iPhone Safari refuses play() that comes after a network wait.
      let url = this.backend.cachedUrl(t);
      if (!url) {
        url = await this.backend.streamUrl(t);
        if (this.current !== t) return; // user moved on while we were fetching
      }
      this.engine.load(url);
      if (autoplay) await this.engine.play();
    } catch (err) {
      if (err?.name === 'NotAllowedError') this.flash('PREMI PLAY PER ASCOLTARE', 4000);
      else toast(`Impossibile riprodurre: ${err.message}`);
    }
  }

  async play() {
    if (this.engine.loaded && this.current) {
      if (this.engine.playing) this.engine.seek(0);
      return this.engine.play().catch((e) => toast(e.message));
    }
    if (!this.playlist.length) {
      if (this.library.length) return this.playNow(this.visibleLibrary().map((t) => t.id));
      return this.pickFiles();
    }
    return this.playIndex(this.index >= 0 ? this.index : 0);
  }

  pause() {
    if (!this.engine.loaded) return;
    if (this.engine.playing) this.engine.pause();
    else this.engine.play();
  }

  stop() {
    this.engine.stop();
  }

  next(auto = false) {
    const n = this.playlist.length;
    if (!n) return;
    let i;
    if (this.shuffle && n > 1) {
      do i = Math.floor(Math.random() * n);
      while (i === this.index);
    } else i = this.index + 1;
    if (i >= n) {
      if (!this.repeat && auto) {
        this.stop();
        return;
      }
      i = 0;
    }
    this.playIndex(i);
  }

  prev() {
    const n = this.playlist.length;
    if (!n) return;
    if (this.engine.time > 3) return this.engine.seek(0);
    if (this.shuffle && this.history.length > 1) {
      this.history.pop();
      return this.playIndex(this.history.pop());
    }
    this.playIndex(this.index > 0 ? this.index - 1 : this.repeat ? n - 1 : 0);
  }

  setShuffle(v) {
    this.shuffle = v;
    store.set('shuffle', v);
    this.flash(v ? 'CASUALE: ATTIVO' : 'CASUALE: SPENTO', 1200);
    this.emit('state');
  }

  setRepeat(v) {
    this.repeat = v;
    store.set('repeat', v);
    this.flash(v ? 'RIPETI: ATTIVO' : 'RIPETI: SPENTO', 1200);
    this.emit('state');
  }

  setVolume(v) {
    this.engine.setVolume(v);
    store.set('volume', this.engine.volume);
  }

  setBalance(b) {
    this.engine.setBalance(b);
    store.set('balance', this.engine.balance);
  }

  updateMediaSession() {
    if (!('mediaSession' in navigator) || !this.current) return;
    const t = this.current;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: t.artist || t.owner,
      album: t.album || this.appName,
      artwork: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' }],
    });
  }

  bindEngine() {
    const e = this.engine;
    e.addEventListener('ended', () => {
      if (this.repeat && this.playlist.length === 1) {
        e.seek(0);
        e.play();
      } else this.next(true);
    });
    e.addEventListener('waiting', () => (this.buffering = true));
    e.addEventListener('playing', () => (this.buffering = false));
    e.addEventListener('timeupdate', () => {
      // count a listen after 30 s (or half of a short track)
      if (!this.counted && this.current && e.time > Math.min(30, (e.duration || 60) / 2)) {
        this.counted = true;
        const t = this.current;
        this.backend
          .countPlay(t.id)
          .then((plays) => {
            if (typeof plays === 'number') t.plays = plays;
            else t.plays++;
            this.emit('library');
          })
          .catch(() => {});
      }
      if ('mediaSession' in navigator && e.duration && navigator.mediaSession.setPositionState) {
        try {
          navigator.mediaSession.setPositionState({ duration: e.duration, position: Math.min(e.time, e.duration) });
        } catch {}
      }
    });
    e.addEventListener('error', async () => {
      // signed URLs expire: refresh once, otherwise report and skip
      const t = this.current;
      if (!t) return;
      if (!this._retryUrl) {
        this._retryUrl = true;
        this.backend.urlCache.delete(t.id);
        const at = e.time;
        try {
          e.load(await this.backend.streamUrl(t));
          e.seek(at);
          await e.play();
          this._retryUrl = false;
          return;
        } catch {}
      }
      this._retryUrl = false;
      toast(`Errore di riproduzione: “${t.title}”`);
    });
    e.addEventListener('nograph', () => toast('Questo server non consente EQ e visualizzatore: l’audio funziona comunque.'));
    if ('mediaSession' in navigator) {
      const ms = navigator.mediaSession;
      const set = (a, fn) => {
        try {
          ms.setActionHandler(a, fn);
        } catch {}
      };
      set('play', () => this.play());
      set('pause', () => this.engine.pause());
      set('stop', () => this.stop());
      set('previoustrack', () => this.prev());
      set('nexttrack', () => this.next());
      set('seekbackward', () => e.seek(e.time - 10));
      set('seekforward', () => e.seek(e.time + 10));
      set('seekto', (d) => e.seek(d.seekTime));
      e.addEventListener('play', () => (ms.playbackState = 'playing'));
      e.addEventListener('pause', () => (ms.playbackState = 'paused'));
    }
  }

  // ----- uploads -----
  pickFiles() {
    const input = h('input', {
      type: 'file',
      multiple: true,
      accept: FORMATS.map((f) => `.${f}`).join(',') + ',audio/*',
    });
    input.addEventListener('change', () => this.upload([...input.files]));
    input.click();
  }

  async upload(files) {
    const ok = files.filter((f) => FORMATS.includes((f.name.split('.').pop() || '').toLowerCase()));
    const skipped = files.length - ok.length;
    if (skipped) toast(`${skipped} file ignorati: formati accettati ${FORMATS.join(', ')}`);
    if (!ok.length) return;
    if (this._uploadQueue) {
      this._uploadQueue.push(...ok);
      return;
    }
    this._uploadQueue = [...ok];
    let done = 0;
    let failed = 0;
    const added = [];
    while (this._uploadQueue.length) {
      const file = this._uploadQueue.shift();
      const total = done + failed + this._uploadQueue.length + 1;
      const n = done + failed + 1;
      const label = (p) => `CARICO ${n}/${total}: ${file.name} ${Math.round(p * 100)}%`;
      this.uploading = label(0);
      this.setLibraryStatus?.(`Carico ${n}/${total}: ${file.name}…`);
      try {
        const meta = await readTags(file);
        const t = await this.backend.uploadTrack(file, meta, (p) => {
          this.uploading = label(p);
          this.setLibraryStatus?.(`Carico ${n}/${total}: ${file.name} — ${Math.round(p * 100)}%`);
        });
        this.library.unshift(t);
        this.tracks.set(t.id, t);
        this.backend.prefetchUrls([t]).catch(() => {});
        added.push(t.id);
        done++;
        this.emit('library');
      } catch (err) {
        failed++;
        toast(`“${file.name}”: ${err.message}`);
      }
    }
    this._uploadQueue = null;
    this.uploading = null;
    this.setLibraryStatus?.(null);
    if (done) {
      toast(`${done} ${done === 1 ? 'brano caricato' : 'brani caricati'}${failed ? `, ${failed} non riusciti` : ''}: ora tutti possono ascoltarli`);
      if (!this.playlist.length) this.setPlaylist(added, -1);
    }
  }

  async updateTrack(id, patch) {
    const t = await this.backend.updateTrack(id, patch);
    const i = this.library.findIndex((x) => x.id === id);
    if (i >= 0) this.library[i] = t;
    this.tracks.set(id, t);
    if (this.current?.id === id) {
      this.current = t;
      this.updateMediaSession();
    }
    this.emit('library');
    this.emit('playlist');
  }

  async deleteTrack(t) {
    try {
      await this.backend.deleteTrack(t);
    } catch (err) {
      return toast(`Impossibile eliminare “${t.title}”: ${err.message}`);
    }
    if (this.current?.id === t.id) {
      this.stop();
      this.current = null;
    }
    this.library = this.library.filter((x) => x.id !== t.id);
    this.tracks.delete(t.id);
    const curId = this.playlist[this.index];
    const next = this.playlist.filter((id) => id !== t.id);
    this.setPlaylist(next, curId && curId !== t.id ? next.indexOf(curId) : -1);
    this.emit('library');
  }

  async savePlaylist(pl) {
    try {
      await this.backend.savePlaylist(pl);
      this.playlists = await this.backend.listPlaylists();
      toast(`Playlist “${pl.name}” salvata: la vedono tutti`);
    } catch (err) {
      toast(`Salvataggio non riuscito: ${err.message}`);
    }
  }

  async deletePlaylist(id) {
    try {
      await this.backend.deletePlaylist(id);
      this.playlists = this.playlists.filter((p) => p.id !== id);
      toast('Playlist eliminata');
    } catch (err) {
      toast(`Eliminazione non riuscita: ${err.message}`);
    }
  }

  // ----- sharing -----
  appUrl() {
    return `${location.origin}${location.pathname}`;
  }

  async copy(text, okMsg) {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMsg);
    } catch {
      await promptBox('Copia questo link', 'Seleziona e copia:', text);
    }
  }

  copyTrackLink(t) {
    if (!t) return;
    this.copy(`${this.appUrl()}#brano=${t.id}`, 'Link copiato: mandalo agli amici (devono avere un account)');
  }

  async showInvite() {
    let code;
    try {
      code = await this.backend.getInvite();
    } catch (err) {
      return alertBox('Invito', err.message);
    }
    const link = `${this.appUrl()}#invito=${b64.enc({ u: this.backend.url, k: this.backend.key, i: code })}`;
    const linkInput = h('input', { class: 'inp', value: link, readonly: true });
    const v = await dialog({
      title: 'INVITA UN AMICO',
      body: h(
        'div',
        {},
        h(
          'p',
          { class: 'dlg-text' },
          'Manda questo link a chi vuoi far entrare: apre il sito già collegato e con il codice invito compilato. Chiunque abbia il link può registrarsi, quindi mandalo solo agli amici.',
        ),
        h('label', { class: 'field' }, h('span', { text: 'Link invito' }), linkInput),
        h('p', { class: 'dlg-text' }, 'Codice invito attuale: ', h('b', { text: code })),
      ),
      buttons: [
        { label: 'Cambia codice…', value: 'change' },
        { label: 'Chiudi', value: null },
        { label: 'Copia link', value: 'copy', primary: true },
      ],
    });
    if (v === 'copy') this.copy(link, 'Link invito copiato');
    if (v === 'change') {
      const next = await promptBox(
        'Nuovo codice invito',
        'I link invito vecchi smetteranno di funzionare (min 6 caratteri)',
        Math.random().toString(36).slice(2, 12),
      );
      if (!next) return;
      try {
        await this.backend.setInvite(next);
        toast('Codice invito aggiornato');
        this.showInvite();
      } catch (err) {
        alertBox('Invito', err.message);
      }
    }
  }

  // ----- menus & dialogs -----
  showOptions(at) {
    const wm = this.wm;
    showMenu(
      [
        { label: `Connesso come ${this.user.username}${this.user.isAdmin ? ' (admin)' : ''}`, disabled: true },
        '-',
        { label: 'Carica brani…', hint: 'L', action: () => this.pickFiles() },
        { label: 'Cerca nella libreria…', hint: 'J', action: () => this.focusSearch() },
        '-',
        { label: 'Lettore', checked: true, disabled: true },
        { label: 'Equalizzatore', hint: 'Alt+G', checked: wm.isVisible('eq'), action: () => wm.toggle('eq') },
        { label: 'Playlist', hint: 'Alt+E', checked: wm.isVisible('pl'), action: () => wm.toggle('pl') },
        { label: 'Libreria condivisa', hint: 'Alt+L', checked: wm.isVisible('lib'), action: () => wm.toggle('lib') },
        { label: 'Dimensione', items: this.scaleItems() },
        { label: 'Ripristina posizione finestre', action: () => wm.resetLayout() },
        '-',
        { label: 'Riproduzione casuale', hint: 'S', checked: this.shuffle, action: () => this.setShuffle(!this.shuffle) },
        { label: 'Ripeti', hint: 'R', checked: this.repeat, action: () => this.setRepeat(!this.repeat) },
        '-',
        ...(this.user.isAdmin ? [{ label: 'Invita un amico…', action: () => this.showInvite() }] : []),
        { label: 'Cambia password…', action: () => this.changePassword() },
        { label: 'Scorciatoie da tastiera', action: () => this.showShortcuts() },
        { label: 'Informazioni', action: () => this.showAbout() },
        '-',
        { label: 'Esci', action: () => this.logout() },
      ],
      at,
    );
  }

  scaleItems() {
    const cur = this.wm.scaleMode;
    return [
      { label: 'Automatica', checked: cur === 'auto', action: () => this.wm.setScale('auto') },
      ...[1, 1.5, 2, 2.5, 3].map((s) => ({
        label: `${s}x`,
        checked: String(cur) === String(s),
        action: () => this.wm.setScale(String(s)),
      })),
    ];
  }

  showScaleMenu(anchor) {
    showMenu(this.scaleItems(), anchor);
  }

  showTrackInfo(t = this.current) {
    if (!t) return toast('Nessun brano selezionato');
    const row = (k, v) => h('tr', {}, h('th', { text: k }), h('td', { text: v }));
    const mb = (t.size / 1048576).toFixed(1);
    dialog({
      title: 'INFO BRANO',
      body: h(
        'table',
        { class: 'info-table' },
        row('Titolo', t.title),
        row('Artista', t.artist || '—'),
        row('Album', t.album || '—'),
        row('Durata', fmtTime(t.duration)),
        row('Formato', `${t.format.toUpperCase()} · ${t.bitrate ? `${t.bitrate} kbps` : '?'} · ${t.sampleRate ? `${t.sampleRate} Hz` : '?'} · ${t.channels === 1 ? 'mono' : 'stereo'}`),
        row('Dimensione', `${mb} MB`),
        row('Caricato da', `${t.owner} il ${new Date(t.createdAt).toLocaleString('it-IT')}`),
        row('Ascolti', String(t.plays)),
      ),
    });
  }

  showShortcuts() {
    const keys = [
      ['X / Spazio', 'Play / pausa'],
      ['C', 'Pausa'],
      ['V', 'Stop'],
      ['Z / B', 'Brano precedente / successivo'],
      ['← / →', 'Indietro / avanti 5 secondi'],
      ['↑ / ↓', 'Volume'],
      ['S / R', 'Casuale / ripeti'],
      ['L', 'Carica brani'],
      ['J', 'Cerca nella libreria'],
      ['Alt+G / Alt+E / Alt+L', 'Mostra EQ / playlist / libreria'],
      ['Doppio clic sul titolo', 'Riduci la finestra'],
      ['Clic sul tempo', 'Tempo trascorso / rimanente'],
      ['Clic sul visualizzatore', 'Spettro / oscilloscopio / spento'],
    ];
    dialog({
      title: 'SCORCIATOIE',
      body: h('table', { class: 'info-table' }, ...keys.map(([k, v]) => h('tr', {}, h('th', { text: k }), h('td', { text: v })))),
    });
  }

  showAbout() {
    dialog({
      title: `INFORMAZIONI SU ${this.appName.toUpperCase()}`,
      body: h(
        'div',
        { class: 'about' },
        h('div', { class: 'about-logo' }),
        h('p', { class: 'dlg-text' }, h('b', { text: `${this.appName} ${VERSION}` })),
        h(
          'p',
          { class: 'dlg-text' },
          'Il vostro lettore in streaming privato: caricate i brani che producete e ascoltateli tra amici, con equalizzatore, playlist condivise e un look da lettore anni ’90.',
        ),
        h('p', { class: 'dlg-text small' }, `${this.library.length} brani in libreria · ${this.playlists.length} playlist condivise`),
      ),
    });
  }

  async changePassword() {
    const pw = field('Nuova password', { type: 'password', autocomplete: 'new-password', minlength: '6' });
    const pw2 = field('Ripeti la nuova password', { type: 'password', autocomplete: 'new-password' });
    await dialog({
      title: 'CAMBIA PASSWORD',
      body: h('div', {}, pw, pw2),
      buttons: [
        { label: 'Annulla', value: null },
        { label: 'Salva', value: true, primary: true },
      ],
      onSubmit: async () => {
        const a = pw.querySelector('input').value;
        if (a.length < 6) throw new Error('Almeno 6 caratteri');
        if (a !== pw2.querySelector('input').value) throw new Error('Le due password non coincidono');
        await this.backend.changePassword(a);
        toast('Password aggiornata');
      },
    });
  }

  async logout() {
    if (!(await confirmBox('Esci', `Vuoi uscire da ${this.appName}?`, 'Esci'))) return;
    this.engine.stop();
    await this.backend.signOut();
    location.reload();
  }

  // ----- wiring -----
  bindKeys() {
    document.addEventListener('keydown', (e) => {
      if (e.target.closest?.('input, textarea, select') || document.querySelector('.overlay')) return;
      const k = e.key.toLowerCase();
      if (e.altKey) {
        const map = { g: 'eq', e: 'pl', l: 'lib' };
        if (map[k]) {
          e.preventDefault();
          this.wm.toggle(map[k]);
        }
        return;
      }
      if (e.ctrlKey || e.metaKey) return;
      const actions = {
        x: () => this.play(),
        ' ': () => (this.engine.loaded ? this.pause() : this.play()),
        c: () => this.pause(),
        v: () => this.stop(),
        z: () => this.prev(),
        b: () => this.next(),
        s: () => this.setShuffle(!this.shuffle),
        r: () => this.setRepeat(!this.repeat),
        l: () => this.pickFiles(),
        j: () => this.focusSearch(),
        arrowleft: () => this.engine.seek(this.engine.time - 5),
        arrowright: () => this.engine.seek(this.engine.time + 5),
        arrowup: () => this.nudgeVolume(0.05),
        arrowdown: () => this.nudgeVolume(-0.05),
      };
      if (actions[k]) {
        e.preventDefault();
        actions[k]();
      }
    });
  }

  nudgeVolume(d) {
    this.setVolume(this.engine.volume + d);
    this.flash(`VOLUME: ${Math.round(this.engine.volume * 100)}%`, 800);
    this.emit('state');
  }

  bindDrop() {
    let depth = 0;
    const hint = h('div', { class: 'drop-hint' }, h('div', {}, 'Rilascia per caricare i brani nel cloud'));
    document.body.append(hint);
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      depth++;
      hint.classList.add('show');
    });
    window.addEventListener('dragleave', (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) hint.classList.remove('show');
    });
    window.addEventListener('dragover', (e) => hasFiles(e) && e.preventDefault());
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      hint.classList.remove('show');
      this.upload([...e.dataTransfer.files]);
    });
  }

  async start(hash) {
    const desktop = $('#desktop');
    const wm = (this.wm = new WindowManager(desktop));
    const phone = document.documentElement.clientWidth < 600;
    wm.add(createMainWindow(this), { id: 'main', x: 0, y: 0 });
    wm.add(createEqWindow(this), { id: 'eq', x: 0, y: 116, hidden: phone });
    wm.add(createPlaylistWindow(this), { id: 'pl', x: 0, y: 232, resizable: true, w: 275, h: 232, minW: 275, minH: 116 });
    wm.add(createLibraryWindow(this), { id: 'lib', x: 275, y: 0, resizable: true, w: 375, h: 464, minW: 275, minH: 116 });
    wm.onchange = () => this.emit('state');
    wm.fit();
    wm.focus('main');
    this.bindEngine();
    this.bindKeys();
    this.bindDrop();
    this.emit('state');

    await this.refresh();
    if (this.index >= 0 && this.playlist[this.index]) {
      this.current = this.tracks.get(this.playlist[this.index]) || null;
      this.emit('track');
    }
    if (hash.track) {
      const t = this.tracks.get(hash.track);
      if (t) {
        this.setPlaylist([...this.playlist, t.id]);
        this.playIndex(this.playlist.length - 1, { autoplay: false });
        this.flash('BRANO CONDIVISO: PREMI PLAY', 6000);
      } else toast('Il brano del link non esiste più');
      history.replaceState(null, '', location.pathname);
    }
    this.backend.onSignedOut(() => location.reload());
    // pick up friends' new uploads without reloading
    setInterval(() => !document.hidden && !this.uploading && this.refresh(), 120_000);
  }
}

async function boot() {
  const hash = readHash();
  const cfg = loadConfig(hash);
  document.title = cfg.appName;
  if (!cfg.url || !cfg.key) await setupDialog(cfg);

  let backend;
  try {
    backend = new Backend(cfg.url, cfg.key);
  } catch (err) {
    await alertBox('Errore', err.message);
    return;
  }
  let user = null;
  try {
    user = await backend.currentUser();
  } catch (err) {
    toast(err.message);
  }
  if (!user) {
    user = await loginDialog(backend, cfg, hash.invite?.code);
    if (hash.invite) history.replaceState(null, '', location.pathname + (hash.track ? `#brano=${hash.track}` : ''));
  }
  document.body.classList.add('ready');
  const app = new App(cfg, backend, user);
  window.ampcloud = app; // handy from the devtools console
  await app.start(hash);
}

boot().catch((err) => {
  console.error(err);
  alertBox('Errore', err.message || String(err));
});
