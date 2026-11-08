// AmpCloud bootstrap and app controller: configuration, login, playback
// queue, uploads, keyboard shortcuts, menus and lock-screen controls.
import { Backend, FORMATS } from './backend.js?v=1.5.0';
import { Engine, IS_IOS } from './engine.js?v=1.5.0';
import { readTags } from './tags.js?v=1.5.0';
import { needsConversion, canUploadAsIs, toMp3, CONVERT_ONLY, TARGET_KBPS, KEEP_MP3_UP_TO, decodeAudio, EncoderPool } from './convert.js?v=1.5.0';
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
} from './ui.js?v=1.5.0';
import { createMainWindow } from './mainwin.js?v=1.5.0';
import { createEqWindow } from './eqwin.js?v=1.5.0';
import { createPlaylistWindow } from './plwin.js?v=1.5.0';
import { createLibraryWindow } from './libwin.js?v=1.5.0';
import { createAnalyzerWindow } from './anwin.js?v=1.5.0';
import { detectBpm } from './bpm.js?v=1.5.0';

const VERSION = '1.5.0';
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
  const forgotNote = h('div', { class: 'dlg-note', role: 'status' });
  const forgot = h(
    'div',
    { class: 'login-only' },
    h('button', {
      type: 'button',
      class: 'linkbtn',
      text: 'Password dimenticata?',
      onclick: async () => {
        const addr = email.querySelector('input').value.trim();
        if (!addr.includes('@')) {
          forgotNote.textContent = 'Scrivi qui sopra la tua email, poi premi di nuovo “Password dimenticata?”.';
          email.querySelector('input').focus();
          return;
        }
        forgotNote.textContent = 'Invio in corso…';
        try {
          await backend.sendPasswordReset(addr);
          forgotNote.textContent =
            'Fatto: se l’email è registrata ti arriva un link (guarda anche nello spam). Aprilo da questo dispositivo e scegli la nuova password. Se non arriva nulla, chiedi all’admin.';
        } catch (err) {
          forgotNote.textContent = err.message;
        }
      },
    }),
    forgotNote,
  );
  const body = h('div', {}, tabs, email, password, forgot, extra);
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
    forgot.hidden = m !== 'login';
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

const norm = (v) =>
  String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');

/** Two library entries (or an entry and a file about to be uploaded) are the
 *  same recording: identical size and length, or same title/artist/length. */
function sameRecording(a, b) {
  const close = Math.abs((a.duration || 0) - (b.duration || 0)) <= 1.5;
  if (!close) return false;
  if (a.size && a.size === b.size) return true;
  return Boolean(norm(a.title)) && norm(a.title) === norm(b.title) && norm(a.artist) === norm(b.artist) && a.duration > 0;
}

/** Drive file/folder ids from pasted share links. */
function parseDriveLinks(text) {
  const out = [];
  for (const raw of String(text).match(/https?:\/\/[^\s<>"']+/g) || []) {
    if (!/(drive|docs)\.google\.com/.test(raw)) continue;
    let m = /\/folders\/([\w-]{10,})/.exec(raw) || (/folderview/.test(raw) && /[?&]id=([\w-]{10,})/.exec(raw));
    if (m) {
      out.push({ folder: true, id: m[1] });
      continue;
    }
    m = /\/d\/([\w-]{10,})/.exec(raw) || /[?&]id=([\w-]{10,})/.exec(raw);
    if (m) out.push({ folder: false, id: m[1] });
  }
  return out.filter((l, i) => out.findIndex((x) => x.id === l.id) === i);
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
    setTimeout(() => this.current === t && this.analyzeBpm(t), 1500);
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

  // ----- BPM -----
  bpmStatus(t) {
    if (!t) return '';
    const s = this._bpm?.[t.id];
    if (s) return s;
    return t.bpm ? 'auto' : '';
  }

  /** Detect the tempo of a track once (downloads the small MP3 again). */
  async analyzeBpm(t) {
    this._bpm ||= {};
    if (!t || t.bpm || this._bpm[t.id] || (t.duration && t.duration > 900)) return;
    this._bpm[t.id] = 'analyzing';
    try {
      const url = this.backend.cachedUrl(t) || (await this.backend.streamUrl(t));
      const res = await fetch(url);
      if (!res.ok) throw new Error(`download ${res.status}`);
      const r = await detectBpm(await res.arrayBuffer());
      if (!r) throw new Error('nessun ritmo');
      await this.setTrackBpm(t, r.bpm, r.offset, 'auto');
    } catch (err) {
      this._bpm[t.id] = 'failed';
      this.backend.log('bpm_fail', { id: t.id, error: String(err?.message || err).slice(0, 200) });
    }
  }

  async setTrackBpm(t, bpm, offset, how) {
    this._bpm ||= {};
    for (const x of [t, this.tracks.get(t.id), this.current?.id === t.id ? this.current : null]) {
      if (x) (x.bpm = bpm), (x.beatOffset = offset);
    }
    this._bpm[t.id] = how;
    this.emit('library');
    if (how === 'manual') toast(`BPM impostati: ${bpm}`);
    await this.backend.setBpm(t.id, bpm, offset).catch((err) => toast(`BPM non salvati: ${err.message}`));
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
    // One file input kept in the page: iPhone Safari may never fire `change`
    // on an input that isn't attached to the document.
    let input = this._picker;
    if (!input) {
      input = this._picker = h('input', {
        type: 'file',
        multiple: true,
        tabindex: '-1',
        'aria-hidden': 'true',
        style: { position: 'fixed', left: '-9999px', top: '0', width: '1px', height: '1px', opacity: '0' },
      });
      // iOS turns `accept` into Apple file types and greys out valid files
      // (m4a, opus, flac…): there we accept anything and filter afterwards.
      if (!IS_IOS) input.accept = [...FORMATS, ...CONVERT_ONLY].map((f) => `.${f}`).join(',') + ',audio/*';
      input.addEventListener('change', () => {
        const files = [...input.files];
        this.backend.log('picker_change', { count: files.length, names: files.map((f) => `${f.name} (${f.size})`).slice(0, 10), v: VERSION });
        input.value = ''; // picking the same file again must fire `change` again
        if (files.length) this.upload(files);
      });
      document.body.append(input);
    }
    this.backend.log('picker_open', { v: VERSION });
    input.click();
  }

  /** Same recording already in the library? (same file size, or same title,
   *  artist and length: a re-upload converted to MP3 has a different size) */
  findDuplicate(c, exceptId) {
    return this.library.find((t) => t.id !== exceptId && sameRecording(t, c)) || null;
  }

  /**
   * Upload queue. Items are File objects or Google Drive jobs
   * ({drive: {id, name}}), which are downloaded first. Files already in the
   * library are skipped. One report at the end.
   */
  async upload(items, prior = []) {
    const accepted = [...FORMATS, ...CONVERT_ONLY];
    const extOf = (name) => (name.split('.').pop() || '').toLowerCase();
    const unsupported = (name) => `formato .${extOf(name)} non supportato (vanno bene ${accepted.join(', ')})`;
    const failures = [...prior];
    const ok = items.filter((it) => {
      if (it.drive) return true; // name may be unknown until downloaded
      if (accepted.includes(extOf(it.name))) return true;
      failures.push([it.name, unsupported(it.name)]);
      return false;
    });
    if (this._uploadQueue) {
      this._uploadQueue.push(...ok);
      this._uploadFailures.push(...failures);
      return;
    }
    if (!ok.length) return this.reportUploadFailures(failures, 0);
    this._uploadQueue = [...ok];
    this._uploadFailures = failures;
    let done = 0;
    const added = [];
    while (this._uploadQueue.length) {
      const item = this._uploadQueue.shift();
      const total = done + this._uploadFailures.length + this._uploadQueue.length + 1;
      const n = done + this._uploadFailures.length + 1;
      let label = item.drive ? item.drive.name || 'file da Google Drive' : item.name;
      const VERBS = { CARICO: 'Carico', COMPRIMO: 'Comprimo', DRIVE: 'Scarico da Drive' };
      const status = (verb, p) => {
        const pct = p === undefined ? '' : ` ${Math.round(p * 100)}%`;
        this.uploading = `${verb} ${n}/${total}: ${label}${pct}`;
        this.setLibraryStatus?.(`${VERBS[verb]} ${n}/${total}: ${label}${pct}`);
      };
      let stage = 'drive';
      let info = { name: label, v: VERSION, drive: Boolean(item.drive) };
      try {
        let file = item;
        if (item.drive) {
          status('DRIVE', 0);
          file = await this.backend.driveFile(item.drive.id, (p) => status('DRIVE', p), item.drive.name);
          label = file.name;
          if (!accepted.includes(extOf(file.name))) throw new Error(unsupported(file.name));
        }
        info = { ...info, name: file.name, size: file.size, type: file.type };
        stage = 'tags';
        status('CARICO', 0);
        this.backend.log('upload_start', info);
        const meta = await readTags(file);
        const dup = this.findDuplicate({ size: file.size, title: meta.title, artist: meta.artist, duration: meta.duration });
        if (dup) throw Object.assign(new Error(`c’è già in libreria: “${dup.title}” (caricato da ${dup.owner})`), { duplicate: true });
        let upload = file;
        if (needsConversion(file, meta)) {
          stage = 'convert';
          // compress to a light MP3 (96 kbps): a fraction of the space, still sounds good
          status('COMPRIMO', 0);
          try {
            const mp3 = await toMp3(file, (p) => status('COMPRIMO', p));
            if (mp3.file.size < file.size || !canUploadAsIs(file)) {
              upload = mp3.file;
              Object.assign(meta, {
                duration: mp3.duration,
                bitrate: mp3.bitrate,
                sampleRate: mp3.sampleRate,
                channels: mp3.channels,
                format: 'mp3',
              });
            }
          } catch (err) {
            // e.g. a format this browser can't decode: send the original if it fits
            if (!canUploadAsIs(file)) throw err;
            this.backend.log('compress_skip', { ...info, error: String(err?.message || err).slice(0, 200) });
          }
        }
        stage = 'upload';
        status('CARICO', 0);
        const t = await this.backend.uploadTrack(upload, meta, (p) => status('CARICO', p));
        this.backend.log('upload_ok', { ...info, uploadedSize: upload.size, duration: meta.duration });
        this.library.unshift(t);
        this.tracks.set(t.id, t);
        this.backend.prefetchUrls([t]).catch(() => {});
        added.push(t.id);
        done++;
        this.emit('library');
      } catch (err) {
        this._uploadFailures.push([label, err.message]);
        if (!err.duplicate)
          this.backend.log('upload_fail', { ...info, stage, error: String(err?.message || err).slice(0, 500) });
      }
    }
    const allFailures = this._uploadFailures;
    this._uploadQueue = null;
    this._uploadFailures = null;
    this.uploading = null;
    this.setLibraryStatus?.(null);
    if (done && !this.playlist.length) this.setPlaylist(added, -1);
    this.reportUploadFailures(allFailures, done);
  }

  showUploadMenu(anchor) {
    showMenu(
      [
        { label: 'Dal dispositivo (file, iCloud, Drive app…)', action: () => this.pickFiles() },
        { label: 'Da Google Drive (incolla un link)…', action: () => this.importFromDrive() },
      ],
      anchor,
    );
  }

  /** Paste links to Drive files/folders shared with "anyone with the link". */
  async importFromDrive() {
    const area = h('textarea', {
      class: 'inp drive-links',
      rows: '4',
      placeholder: 'https://drive.google.com/drive/folders/…\nhttps://drive.google.com/file/d/…',
      spellcheck: 'false',
      autocapitalize: 'off',
    });
    const progress = h('div', { class: 'dlg-note', role: 'status' });
    let jobs = [];
    const accepted = [...FORMATS, ...CONVERT_ONLY];
    const v = await dialog({
      title: 'IMPORTA DA GOOGLE DRIVE',
      body: h(
        'div',
        {},
        h(
          'p',
          { class: 'dlg-text' },
          'In Google Drive: tasto destro (o ⋮) sul file o sulla cartella → ',
          h('b', { text: 'Condividi' }),
          ' → Accesso generale: ',
          h('b', { text: 'Chiunque abbia il link' }),
          '. Poi copia il link e incollalo qui (anche più link, uno per riga). Da una cartella prendo tutti i file audio, anche nelle sottocartelle.',
        ),
        area,
        progress,
      ),
      buttons: [
        { label: 'Annulla', value: null },
        { label: 'Importa', value: 'go', primary: true },
      ],
      onSubmit: async () => {
        const links = parseDriveLinks(area.value);
        if (!links.length) throw new Error('Non trovo link di Google Drive: incolla il link di condivisione');
        jobs = [];
        const walk = async (folderId, depth) => {
          progress.textContent = `Leggo la cartella… (${jobs.length} file audio trovati)`;
          for (const e of await this.backend.driveList(folderId)) {
            if (e.folder) {
              if (depth < 3) await walk(e.id, depth + 1);
            } else if (accepted.includes((e.name.split('.').pop() || '').toLowerCase())) {
              jobs.push({ drive: { id: e.id, name: e.name } });
            }
          }
        };
        try {
          for (const l of links) {
            if (l.folder) await walk(l.id, 0);
            else jobs.push({ drive: { id: l.id, name: '' } });
          }
        } finally {
          progress.textContent = '';
        }
        if (!jobs.length) throw new Error('Nessun file audio nella cartella (mp3, wav, flac, m4a…)');
      },
    });
    if (v !== 'go' || !jobs.length) return;
    toast(`Importo ${jobs.length} ${jobs.length === 1 ? 'file' : 'file'} da Google Drive…`);
    this.backend.log('drive_import', { count: jobs.length, v: VERSION });
    this.upload(jobs);
  }

  /**
   * Admin tool: re-encode every track that isn't already a light MP3 to
   * TARGET_KBPS, swapping the file in place (same id, plays, playlists).
   * Runs in this browser, several tracks at a time; safe to stop and resume.
   */
  async compressLibrary() {
    if (!this.user.isAdmin) return alertBox('COMPRIMI LIBRERIA', 'Solo l’admin può comprimere la libreria.');
    if (this._compress) return toast('La compressione è già in corso');
    const isLight = (t) => t.format === 'mp3' && t.bitrate > 0 && t.bitrate <= KEEP_MP3_UP_TO;
    const todo = this.library.filter((t) => !isLight(t)).sort((a, b) => b.size - a.size);
    if (!todo.length) return alertBox('COMPRIMI LIBRERIA', 'Tutti i brani sono già compressi.');
    const MB = (b) => Math.round(b / 1048576).toLocaleString('it-IT');
    const before = todo.reduce((s, t) => s + t.size, 0);
    const after = todo.reduce((s, t) => s + (t.duration || 0) * TARGET_KBPS * 125, 0);
    const pool = new EncoderPool();
    const minutes = Math.ceil(todo.reduce((s, t) => s + (t.duration || 0), 0) / (8 * pool.size) / 60);
    const go = await dialog({
      title: 'COMPRIMI LIBRERIA',
      body: h(
        'div',
        {},
        h('p', {
          class: 'dlg-text',
          text: `${todo.length} brani da comprimere: ${MB(before)} MB → circa ${MB(after)} MB (MP3 ${TARGET_KBPS} kbps). Titoli, ascolti e playlist restano.`,
        }),
        h('p', {
          class: 'dlg-text',
          text: `Lavora questo computer: tienilo acceso con questa pagina aperta (circa ${minutes <= 1 ? 'un minuto' : minutes < 90 ? `${minutes} minuti` : `${Math.round(minutes / 6) / 10} ore`}, dipende dal computer e dalla connessione). Puoi interrompere dal menu O e riprendere quando vuoi: i brani già fatti vengono saltati.`,
        }),
        h('p', { class: 'dlg-text small', text: 'Gli originali sul server vengono sostituiti: l’operazione non si può annullare.' }),
      ),
      buttons: [
        { label: 'Annulla', value: null },
        { label: 'Comprimi', value: true, primary: true },
      ],
    });
    if (!go) return pool.close();

    const run = (this._compress = { stop: false, done: 0, failed: 0, skipped: 0, saved: 0, total: todo.length });
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    let wake = null;
    try {
      wake = await navigator.wakeLock?.request('screen');
    } catch {}
    this.backend.log('compress_run', { count: todo.length, mb: MB(before), workers: pool.size, v: VERSION });
    const show = () => {
      const n = run.done + run.failed + run.skipped;
      this.uploading = `COMPRIMO LIBRERIA ${n}/${run.total} - RISPARMIATI ${MB(run.saved)} MB`;
      this.setLibraryStatus?.(`Compressione ${n}/${run.total} · risparmiati ${MB(run.saved)} MB${run.stop ? ' · mi fermo…' : ''}`);
    };
    show();

    // memory guard: decoded audio is big, so cap the seconds of audio in flight
    const BUDGET = 1500;
    let inUse = 0;
    const waiters = [];
    const acquire = async (cost) => {
      while (inUse > 0 && inUse + cost > BUDGET) await new Promise((r) => waiters.push(r));
      inUse += cost;
    };
    const release = (cost) => {
      inUse -= cost;
      waiters.splice(0).forEach((r) => r());
    };

    const one = async (t) => {
      const cost = Math.min(BUDGET, Math.max(60, t.duration || 300));
      await acquire(cost);
      try {
        if (run.stop) return;
        if (this.current?.id === t.id && this.engine.playing) {
          run.skipped++; // don't swap the file under the track that's playing
          return;
        }
        const url = this.backend.cachedUrl(t) || (await this.backend.streamUrl(t));
        const res = await fetch(url);
        if (!res.ok) throw new Error(`download ${res.status}`);
        const audio = await decodeAudio(await res.arrayBuffer());
        const { blob, kbps, channels } = await pool.encode(audio, TARGET_KBPS, 48);
        if (blob.size >= t.size * 0.9) {
          run.skipped++;
          return;
        }
        const nt = await this.backend.replaceTrackAudio(t, blob, { bitrate: kbps, sampleRate: 44100, channels, duration: audio.duration });
        const i = this.library.findIndex((x) => x.id === t.id);
        if (i >= 0) this.library[i] = nt;
        this.tracks.set(t.id, nt);
        run.saved += t.size - blob.size;
        run.done++;
        this.backend.log('compress_ok', { id: t.id, from: t.size, to: blob.size });
      } catch (err) {
        run.failed++;
        this.backend.log('compress_fail', { id: t.id, title: t.title, size: t.size, error: String(err?.message || err).slice(0, 300) });
      } finally {
        release(cost);
        show();
      }
    };

    let next = 0;
    const lanes = Array.from({ length: pool.size + 1 }, async () => {
      while (next < todo.length && !run.stop) await one(todo[next++]);
    });
    await Promise.all(lanes);
    pool.close();
    window.removeEventListener('beforeunload', warn);
    wake?.release?.().catch?.(() => {});
    this._compress = null;
    this.uploading = null;
    this.setLibraryStatus?.(null);
    this.emit('library');
    this.backend.log('compress_end', { done: run.done, failed: run.failed, skipped: run.skipped, savedMB: MB(run.saved) });
    alertBox(
      'COMPRIMI LIBRERIA',
      `${run.stop ? 'Interrotta. ' : 'Finito! '}Compressi ${run.done} brani, risparmiati ${MB(run.saved)} MB.` +
        (run.failed ? ` ${run.failed} non riusciti (riprova più tardi).` : '') +
        (run.skipped ? ` ${run.skipped} saltati.` : '') +
        (run.stop || run.failed ? ' Rilancia la compressione per continuare: i brani già fatti vengono saltati.' : ''),
    );
  }

  /** Find recordings uploaded more than once and delete the extra copies. */
  async removeDuplicates() {
    const lib = this.library;
    const used = new Set();
    const toDelete = [];
    let othersOnly = 0;
    for (let i = 0; i < lib.length; i++) {
      if (used.has(i)) continue;
      const group = [lib[i]];
      for (let j = i + 1; j < lib.length; j++) {
        if (!used.has(j) && sameRecording(lib[i], lib[j])) {
          used.add(j);
          group.push(lib[j]);
        }
      }
      if (group.length < 2) continue;
      // keep a copy I can't delete if there is one, else the most played, else the oldest
      group.sort(
        (a, b) =>
          Number(this.canEdit(a)) - Number(this.canEdit(b)) || b.plays - a.plays || a.createdAt - b.createdAt,
      );
      const [keep, ...extra] = group;
      for (const t of extra) {
        if (this.canEdit(t)) toDelete.push({ t, keep });
        else othersOnly++;
      }
    }
    if (!toDelete.length) {
      return alertBox(
        'DUPLICATI',
        othersOnly
          ? `Ci sono ${othersOnly} doppioni caricati da altri: può eliminarli chi li ha caricati, o l’admin.`
          : 'Nessun brano duplicato in libreria.',
      );
    }
    const rows = toDelete
      .slice(0, 40)
      .map(({ t, keep }) =>
        h('tr', {}, h('th', { text: `${t.title} (${t.owner})` }), h('td', { text: `copia di “${keep.title}”` })),
      );
    const ok = await dialog({
      title: 'ELIMINA DUPLICATI',
      body: h(
        'div',
        {},
        h('p', {
          class: 'dlg-text',
          text: `Ho trovato ${toDelete.length} ${toDelete.length === 1 ? 'copia in più' : 'copie in più'}. Tengo l’originale (il più ascoltato) ed elimino queste dal cloud:`,
        }),
        h('table', { class: 'info-table' }, ...rows),
        toDelete.length > 40 ? h('p', { class: 'dlg-text small', text: `…e altre ${toDelete.length - 40}.` }) : null,
        othersOnly ? h('p', { class: 'dlg-text small', text: `${othersOnly} doppioni sono di altri: li lascio.` }) : null,
      ),
      buttons: [
        { label: 'Annulla', value: null },
        { label: `Elimina ${toDelete.length}`, value: true, primary: true },
      ],
    });
    if (!ok) return;
    // point playlists at the copy we keep, so nothing disappears from them
    const remap = new Map(toDelete.map(({ t, keep }) => [t.id, keep.id]));
    const fix = (ids) => ids.map((id) => remap.get(id) || id).filter((id, i, a) => a.indexOf(id) === i);
    const curId = this.playlist[this.index];
    const local = fix(this.playlist);
    this.setPlaylist(local, curId ? local.indexOf(remap.get(curId) || curId) : -1);
    for (const p of this.playlists) {
      if (!p.trackIds.some((id) => remap.has(id)) || !(p.ownerId === this.user.id || this.user.isAdmin)) continue;
      p.trackIds = fix(p.trackIds);
      await this.backend.savePlaylist({ id: p.id, name: p.name, trackIds: p.trackIds }).catch(() => {});
    }
    let n = 0;
    for (const { t } of toDelete) {
      this.setLibraryStatus?.(`Elimino duplicati ${++n}/${toDelete.length}…`);
      await this.deleteTrack(t);
    }
    this.setLibraryStatus?.(null);
    toast(`Eliminati ${n} duplicati`);
  }

  /** Toasts vanish: when something fails, say exactly which files and why. */
  reportUploadFailures(failures, done) {
    const ok = done ? `${done} ${done === 1 ? 'brano caricato' : 'brani caricati'}: ora tutti possono ascoltarli. ` : '';
    if (!failures.length) {
      if (done) toast(ok);
      return;
    }
    dialog({
      title: 'CARICAMENTO',
      body: h(
        'div',
        {},
        h('p', { class: 'dlg-text', text: `${ok}Non sono riuscito a caricare:` }),
        h(
          'table',
          { class: 'info-table' },
          ...failures.map(([name, why]) => h('tr', {}, h('th', { text: name }), h('td', { text: why }))),
        ),
      ),
    });
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

  async downloadTracks(tracks) {
    tracks = tracks.filter(Boolean);
    if (!tracks.length) return toast('Seleziona prima un brano');
    for (const [i, t] of tracks.entries()) {
      try {
        const a = h('a', { href: await this.backend.downloadUrl(t), download: this.backend.downloadName(t), rel: 'noopener' });
        document.body.append(a);
        a.click();
        a.remove();
      } catch (err) {
        toast(`Download non riuscito (“${t.title}”): ${err.message}`);
      }
      // browsers drop downloads fired in a burst
      if (i < tracks.length - 1) await new Promise((r) => setTimeout(r, 800));
    }
    toast(tracks.length === 1 ? `Download di “${tracks[0].title}” avviato` : `${tracks.length} download avviati`);
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
        { label: 'Importa da Google Drive…', action: () => this.importFromDrive() },
        { label: 'Elimina file duplicati…', action: () => this.removeDuplicates() },
        ...(this.user.isAdmin
          ? [
              this._compress
                ? { label: 'Interrompi la compressione', action: () => ((this._compress.stop = true), toast('Finisco i brani in corso e mi fermo')) }
                : { label: 'Comprimi la libreria (admin)…', action: () => this.compressLibrary() },
            ]
          : []),
        { label: 'Cerca nella libreria…', hint: 'J', action: () => this.focusSearch() },
        { label: 'Scarica il brano in ascolto', action: () => this.downloadTracks([this.current]), disabled: !this.current },
        '-',
        { label: 'Lettore', checked: true, disabled: true },
        { label: 'Equalizzatore', hint: 'Alt+G', checked: wm.isVisible('eq'), action: () => wm.toggle('eq') },
        { label: 'Playlist', hint: 'Alt+E', checked: wm.isVisible('pl'), action: () => wm.toggle('pl') },
        { label: 'Libreria condivisa', hint: 'Alt+L', checked: wm.isVisible('lib'), action: () => wm.toggle('lib') },
        { label: 'Analizzatore (BPM, VU)', hint: 'Alt+A', checked: wm.isVisible('an'), action: () => wm.toggle('an') },
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
        row('BPM', t.bpm ? `${t.bpm}` : 'non ancora rilevati'),
      ),
      buttons: [
        { label: 'Chiudi', value: null },
        { label: '⬇ Scarica', value: 'download', primary: true },
      ],
    }).then((v) => v === 'download' && this.downloadTracks([t]));
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
        h(
          'p',
          { class: 'dlg-text small' },
          'Conversione in MP3 con LAME (',
          h('a', { href: 'https://lame.sourceforge.io/', target: '_blank', rel: 'noopener' }, 'lame.sourceforge.io'),
          ', LGPL, via lamejs).',
        ),
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
        const map = { g: 'eq', e: 'pl', l: 'lib', a: 'an' };
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
    this.backend.log('app_start', { v: VERSION, w: innerWidth, h: innerHeight });
    window.addEventListener('error', (e) => this.backend.log('js_error', { msg: String(e.message).slice(0, 300), src: `${e.filename}:${e.lineno}` }));
    window.addEventListener('unhandledrejection', (e) => this.backend.log('js_rejection', { msg: String(e.reason?.message || e.reason).slice(0, 300) }));
    const desktop = $('#desktop');
    const wm = (this.wm = new WindowManager(desktop));
    const phone = document.documentElement.clientWidth < 600;
    wm.add(createMainWindow(this), { id: 'main', x: 0, y: 0 });
    wm.add(createEqWindow(this), { id: 'eq', x: 0, y: 116, hidden: phone });
    wm.add(createPlaylistWindow(this), { id: 'pl', x: 0, y: 232, resizable: true, w: 275, h: 232, minW: 275, minH: 116 });
    wm.add(createLibraryWindow(this), { id: 'lib', x: 275, y: 0, resizable: true, w: 375, h: 348, minW: 275, minH: 116 });
    // the analyzer docks under the library, wherever the user left it
    const libPos = store.get('win:lib', null);
    wm.add(createAnalyzerWindow(this), {
      id: 'an',
      x: libPos ? libPos.x : 275,
      y: libPos ? libPos.y + (libPos.shade ? 14 : libPos.h) : 348,
    });
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

async function newPasswordDialog(backend) {
  const pw = field('Nuova password', { type: 'password', autocomplete: 'new-password', minlength: '6' });
  const pw2 = field('Ripeti la nuova password', { type: 'password', autocomplete: 'new-password' });
  await dialog({
    title: 'SCEGLI UNA NUOVA PASSWORD',
    dismissable: false,
    body: h('div', {}, h('p', { class: 'dlg-text', text: 'Sei entrato con il link dell’email. Scegli la nuova password:' }), pw, pw2),
    buttons: [{ label: 'Salva', value: true, primary: true }],
    onSubmit: async () => {
      const a = pw.querySelector('input').value;
      if (a.length < 6) throw new Error('Almeno 6 caratteri');
      if (a !== pw2.querySelector('input').value) throw new Error('Le due password non coincidono');
      await backend.changePassword(a);
      backend.recovery = false;
      toast('Password aggiornata');
    },
  });
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
  const linkError = new URLSearchParams(location.hash.slice(1)).get('error_description');
  if (linkError) {
    history.replaceState(null, '', location.pathname);
    await alertBox('Link non valido', `Il link dell’email non funziona più (${linkError}). Chiedi un nuovo link da “Password dimenticata?”.`);
  }
  if (user && backend.recovery) {
    // opened from the reset email: the link logged us in, now pick a password
    history.replaceState(null, '', location.pathname);
    await newPasswordDialog(backend);
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
