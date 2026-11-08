// All server access goes through Supabase: Auth (accounts), Postgres with
// row-level security (tracks, playlists, profiles) and a private Storage
// bucket for the audio files, streamed with short-lived signed URLs.

const BUCKET = 'tracks';
const SIGNED_URL_TTL = 6 * 3600; // seconds
const MIME = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  wav: 'audio/wav',
  webm: 'audio/webm',
};
export const FORMATS = Object.keys(MIME);

// crypto.randomUUID only exists from iOS 15.4 / Safari 15.4
const uuid = () =>
  crypto.randomUUID?.() ??
  ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16),
  );

const SIGNUP_ERRORS = {
  invalid_invite: 'Codice invito errato',
  bad_username: 'Nome utente: 2-24 caratteri, solo lettere, numeri, _ . -',
  username_taken: 'Nome utente già in uso',
};

function friendly(error) {
  const msg = String(error?.message || error || 'Errore sconosciuto');
  if (/Invalid login credentials/i.test(msg)) return 'Email o password errati';
  if (/Email not confirmed/i.test(msg)) return 'Devi prima confermare l’email (controlla la posta)';
  if (/already registered/i.test(msg)) return 'Esiste già un account con questa email';
  if (/Password should be/i.test(msg)) return 'Password troppo corta (minimo 6 caratteri)';
  if (/rate limit/i.test(msg)) return 'Troppi tentativi: riprova tra qualche minuto';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Server non raggiungibile: controlla la connessione';
  if (/Database error saving new user/i.test(msg)) return 'Registrazione rifiutata (codice invito o nome utente non validi)';
  if (/relation .* does not exist|schema cache/i.test(msg))
    return 'Il database non è configurato: esegui schema.sql nel progetto Supabase';
  return msg;
}

const toTrack = (r) => ({
  id: r.id,
  title: r.title,
  artist: r.artist || '',
  album: r.album || '',
  duration: Number(r.duration) || 0,
  bitrate: r.bitrate || 0,
  sampleRate: r.sample_rate || 0,
  channels: r.channels || 2,
  size: Number(r.size) || 0,
  format: r.format || '',
  path: r.path,
  plays: r.plays || 0,
  createdAt: Date.parse(r.created_at) || 0,
  ownerId: r.owner_id,
  owner: r.owner?.username || '?',
});

export class Backend {
  constructor(url, anonKey) {
    if (!window.supabase?.createClient) throw new Error('Libreria Supabase non caricata');
    this.url = url.replace(/\/+$/, '');
    this.key = anonKey;
    this.sb = window.supabase.createClient(this.url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'ampcloud-auth' },
    });
    this.urlCache = new Map();
    // set when the page was opened from a "reset your password" email link
    this.recovery = /type=recovery/.test(location.hash + location.search);
    this.sb.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') this.recovery = true;
    });
    this.user = null;
  }

  async _check(promise) {
    const { data, error } = await promise;
    if (error) throw new Error(friendly(error));
    return data;
  }

  /** Current profile ({id, username, isAdmin, email}) or null. */
  async currentUser() {
    const { data } = await this.sb.auth.getSession();
    const session = data?.session;
    if (!session) return (this.user = null);
    const row = await this._check(
      this.sb.from('profiles').select('id, username, is_admin').eq('id', session.user.id).maybeSingle(),
    );
    if (!row) return (this.user = null);
    this.user = { id: row.id, username: row.username, isAdmin: row.is_admin, email: session.user.email };
    return this.user;
  }

  onSignedOut(cb) {
    this.sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') cb();
    });
  }

  async signIn(email, password) {
    await this._check(this.sb.auth.signInWithPassword({ email: email.trim(), password }));
    const user = await this.currentUser();
    if (!user) throw new Error('Account senza profilo: registrati di nuovo dal sito');
    return user;
  }

  /** Returns {user} when logged in right away, or {confirm: true} if Supabase wants email confirmation. */
  async signUp({ email, password, username, invite }) {
    username = username.trim();
    const res = await this._check(this.sb.rpc('check_signup', { invite, username }));
    if (res !== 'ok') throw new Error(SIGNUP_ERRORS[res] || 'Registrazione rifiutata');
    const data = await this._check(
      this.sb.auth.signUp({ email: email.trim(), password, options: { data: { username, invite } } }),
    );
    if (!data.session) return { confirm: true };
    return { user: await this.currentUser() };
  }

  async signOut() {
    this.urlCache.clear();
    await this.sb.auth.signOut();
    this.user = null;
  }

  /** Email a password-reset link that brings the user back to this page. */
  async sendPasswordReset(email) {
    await this._check(
      this.sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}${location.pathname}` }),
    );
  }

  async changePassword(password) {
    await this._check(this.sb.auth.updateUser({ password }));
  }

  /** Best-effort diagnostic event (upload steps, errors). Never throws. */
  log(event, detail = {}) {
    if (!this.user || (this._logged = (this._logged || 0) + 1) > 60) return;
    this.sb
      .from('client_logs')
      .insert({ event, detail, user_agent: navigator.userAgent.slice(0, 400) })
      .then(() => {}, () => {});
  }

  // ---------- Google Drive (through the drive-import edge function) ----------
  async _fnFetch(params) {
    const { data } = await this.sb.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) throw new Error('Sessione scaduta: rientra');
    const res = await fetch(`${this.url}/functions/v1/drive-import?${new URLSearchParams(params)}`, {
      headers: { Authorization: `Bearer ${token}`, apikey: this.key },
    }).catch(() => {
      throw new Error('Google Drive non raggiungibile');
    });
    if (!res.ok) {
      let msg = `Errore ${res.status}`;
      try {
        msg = (await res.json()).error || msg;
      } catch {}
      if (res.status === 404 && /requested function/i.test(msg)) msg = 'Import da Drive non installato sul server';
      throw new Error(msg);
    }
    return res;
  }

  /** Files (and subfolders) of a folder shared with "anyone with the link". */
  async driveList(folderId) {
    return (await this._fnFetch({ action: 'list', id: folderId })).json();
  }

  /** Download one shared Drive file as a File, with progress 0..1. */
  async driveFile(fileId, onProgress = () => {}, fallbackName = '') {
    const res = await this._fnFetch({ action: 'file', id: fileId });
    const name = decodeURIComponent(res.headers.get('x-file-name') || '') || fallbackName || `${fileId}.mp3`;
    const total = Number(res.headers.get('content-length') || 0);
    const type = res.headers.get('content-type') || '';
    if (!res.body || !total) return new File([await res.blob()], name, { type });
    const reader = res.body.getReader();
    const parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      onProgress(got / total);
    }
    return new File(parts, name, { type });
  }

  // ---------- tracks ----------
  async listTracks() {
    const rows = await this._check(
      this.sb.from('tracks').select('*, owner:profiles(username)').order('created_at', { ascending: false }),
    );
    return rows.map(toTrack);
  }

  /** PUT a blob into the bucket at `path`, with upload progress 0..1. */
  async putObject(path, blob, mime, onProgress = () => {}) {
    const { data } = await this.sb.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) throw new Error('Sessione scaduta: rientra');
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${this.url}/storage/v1/object/${BUCKET}/${path}`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('apikey', this.key);
      xhr.setRequestHeader('x-upsert', 'false');
      xhr.setRequestHeader('cache-control', '86400');
      xhr.setRequestHeader('Content-Type', mime);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) return resolve();
        let msg = `Errore ${xhr.status}`;
        try {
          const j = JSON.parse(xhr.responseText);
          msg = j.message || j.error || msg;
        } catch {}
        if (xhr.status === 413 || /too large|exceeded the maximum/i.test(msg))
          msg = 'File troppo grande per il piano Supabase (gratis: max 50 MB a file)';
        reject(new Error(msg));
      };
      xhr.onerror = () => reject(new Error('Caricamento interrotto (rete)'));
      xhr.send(blob);
    });
  }

  /**
   * Swap a track's audio for a re-encoded MP3 (admin library compression):
   * upload the new file, point the row at it, then delete the old file.
   */
  async replaceTrackAudio(track, blob, meta) {
    if (!this.user) throw new Error('Sessione scaduta: rientra');
    const path = `${this.user.id}/${uuid()}.mp3`;
    await this.putObject(path, blob, 'audio/mpeg');
    let row;
    try {
      row = await this._check(
        this.sb
          .from('tracks')
          .update({
            path,
            size: blob.size,
            format: 'mp3',
            bitrate: meta.bitrate,
            sample_rate: meta.sampleRate,
            channels: meta.channels,
            duration: meta.duration,
          })
          .eq('id', track.id)
          .select('*, owner:profiles(username)')
          .single(),
      );
    } catch (err) {
      await this.sb.storage.from(BUCKET).remove([path]);
      throw err;
    }
    await this.sb.storage.from(BUCKET).remove([track.path]);
    this.urlCache.delete(track.id);
    return toTrack(row);
  }

  /** Upload a file with progress, then register it in the database. */
  async uploadTrack(file, meta, onProgress = () => {}) {
    const { data } = await this.sb.auth.getSession();
    if (!data?.session?.access_token || !this.user) throw new Error('Sessione scaduta: rientra');
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!MIME[ext]) throw new Error(`Formato non supportato (.${ext}). Usa: ${FORMATS.join(', ')}`);
    const path = `${this.user.id}/${uuid()}.${ext}`;
    await this.putObject(path, file, MIME[ext], onProgress);

    try {
      const row = await this._check(
        this.sb
          .from('tracks')
          .insert({
            title: (meta.title || file.name).slice(0, 200),
            artist: (meta.artist || '').slice(0, 200),
            album: (meta.album || '').slice(0, 200),
            duration: meta.duration || 0,
            bitrate: meta.bitrate || 0,
            sample_rate: meta.sampleRate || 0,
            channels: meta.channels || 2,
            size: file.size,
            format: ext,
            path,
          })
          .select('*, owner:profiles(username)')
          .single(),
      );
      return toTrack(row);
    } catch (err) {
      await this.sb.storage.from(BUCKET).remove([path]);
      throw err;
    }
  }

  async updateTrack(id, patch) {
    const row = await this._check(
      this.sb.from('tracks').update(patch).eq('id', id).select('*, owner:profiles(username)').single(),
    );
    return toTrack(row);
  }

  async deleteTrack(track) {
    await this._check(this.sb.from('tracks').delete().eq('id', track.id));
    await this.sb.storage.from(BUCKET).remove([track.path]);
    this.urlCache.delete(track.id);
  }

  /** File name for a download: "Artista - Titolo.mp3". */
  downloadName(track) {
    const ext = track.format || track.path.split('.').pop() || 'mp3';
    const base = `${track.artist ? `${track.artist} - ` : ''}${track.title}`
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
      .trim()
      .slice(0, 150);
    return `${base || 'brano'}.${ext}`;
  }

  /** Signed URL that makes the browser save the file instead of playing it.
   *  Storage reads `download` from the query string, outside the signed token,
   *  so a cached streaming URL works without another round trip. */
  async downloadUrl(track) {
    const url = this.cachedUrl(track) || (await this.streamUrl(track));
    return `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(this.downloadName(track))}`;
  }

  /** Signed URL already in hand (valid for at least another minute), or null. */
  cachedUrl(track) {
    const hit = this.urlCache.get(track.id);
    return hit && hit.expires > Date.now() + 60_000 ? hit.url : null;
  }

  /** Sign URLs for many tracks in a few requests, ahead of time. */
  async prefetchUrls(tracks) {
    const soon = Date.now() + 30 * 60_000;
    const need = tracks.filter((t) => !(this.urlCache.get(t.id)?.expires > soon));
    for (let i = 0; i < need.length; i += 100) {
      const chunk = need.slice(i, i + 100);
      const { data, error } = await this.sb.storage.from(BUCKET).createSignedUrls(
        chunk.map((t) => t.path),
        SIGNED_URL_TTL,
      );
      if (error || !data) continue;
      const expires = Date.now() + SIGNED_URL_TTL * 1000;
      for (const row of data) {
        const t = chunk.find((x) => x.path === row.path);
        if (t && row.signedUrl) this.urlCache.set(t.id, { url: row.signedUrl, expires });
      }
    }
  }

  async streamUrl(track) {
    const hit = this.urlCache.get(track.id);
    if (hit && hit.expires > Date.now() + 60_000) return hit.url;
    const data = await this._check(this.sb.storage.from(BUCKET).createSignedUrl(track.path, SIGNED_URL_TTL));
    this.urlCache.set(track.id, { url: data.signedUrl, expires: Date.now() + SIGNED_URL_TTL * 1000 });
    return data.signedUrl;
  }

  async countPlay(id) {
    return this._check(this.sb.rpc('count_play', { track: id }));
  }

  // ---------- playlists ----------
  async listPlaylists() {
    const rows = await this._check(
      this.sb.from('playlists').select('*, owner:profiles(username)').order('updated_at', { ascending: false }),
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      trackIds: r.track_ids || [],
      ownerId: r.owner_id,
      owner: r.owner?.username || '?',
    }));
  }

  async savePlaylist({ id, name, trackIds }) {
    const body = { name, track_ids: trackIds, updated_at: new Date().toISOString() };
    if (id) await this._check(this.sb.from('playlists').update(body).eq('id', id));
    else await this._check(this.sb.from('playlists').insert(body));
  }

  async deletePlaylist(id) {
    await this._check(this.sb.from('playlists').delete().eq('id', id));
  }

  // ---------- admin ----------
  async getInvite() {
    return this._check(this.sb.rpc('get_invite_code'));
  }

  async setInvite(code) {
    return this._check(this.sb.rpc('set_invite_code', { code }));
  }
}
