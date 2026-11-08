// AmpCloud — Supabase Edge Function "drive-import"
//
// Browsers can't download from Google Drive directly (no CORS headers), so
// this function is a narrow bridge: it only ever talks to Google Drive, only
// for logged-in AmpCloud users (verify_jwt on), and only for files/folders
// shared as "Anyone with the link". The browser then uploads the file to the
// private bucket through the normal upload path (tags, conversion, progress).
//
//   GET ?action=list&id=FOLDER_ID  -> [{ id, name, folder }]
//   GET ?action=file&id=FILE_ID    -> the file bytes (x-file-name header)
//
// Deploy: Supabase dashboard → Edge Functions → new function "drive-import",
// paste this file; or `supabase functions deploy drive-import`.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Expose-Headers': 'content-length, content-type, x-file-name',
};
const MAX_BYTES = 200 * 1024 * 1024;
const UA = 'Mozilla/5.0 (compatible; AmpCloud drive-import)';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const decodeHtml = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

/** Files and subfolders of a folder shared with "Anyone with the link". */
async function listFolder(id: string) {
  const r = await fetch(`https://drive.google.com/embeddedfolderview?id=${id}`, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(r.status === 404 ? 'Cartella non trovata o non condivisa' : `Google Drive: errore ${r.status}`);
  const html = await r.text();
  const out: { id: string; name: string; folder: boolean }[] = [];
  const re = /id="entry-([\w-]+)"[\s\S]*?<a href="([^"]*)"[\s\S]*?class="flip-entry-title">([^<]*)</g;
  for (const m of html.matchAll(re)) {
    out.push({ id: m[1], name: decodeHtml(m[3]).trim(), folder: m[2].includes('/folders/') });
  }
  if (!out.length && /accounts\.google\.com|ServiceLogin/.test(html))
    throw new Error('La cartella non è condivisa con "Chiunque abbia il link"');
  return out;
}

function filenameFrom(disposition: string | null) {
  if (!disposition) return '';
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch { /* fall through */ }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain ? plain[1] : '';
}

async function downloadFile(id: string) {
  const r = await fetch(`https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`, {
    headers: { 'User-Agent': UA },
    redirect: 'follow',
  });
  const type = r.headers.get('content-type') || '';
  if (r.status === 404) return json({ error: 'File non trovato su Google Drive' }, 404);
  if (!r.ok) return json({ error: `Google Drive: errore ${r.status}` }, 502);
  if (type.includes('text/html')) {
    await r.body?.cancel();
    return json({ error: 'Il file non è condiviso con "Chiunque abbia il link"' }, 403);
  }
  const size = Number(r.headers.get('content-length') || 0);
  if (size > MAX_BYTES) {
    await r.body?.cancel();
    return json({ error: 'File troppo grande (oltre 200 MB)' }, 413);
  }
  const headers: Record<string, string> = {
    ...CORS,
    'Content-Type': type || 'application/octet-stream',
    'x-file-name': encodeURIComponent(filenameFrom(r.headers.get('content-disposition')) || `${id}.mp3`),
    'Cache-Control': 'no-store',
  };
  if (size) headers['Content-Length'] = String(size);
  return new Response(r.body, { headers });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'GET') return json({ error: 'Metodo non consentito' }, 405);
  const url = new URL(req.url);
  const id = url.searchParams.get('id') || '';
  if (!/^[\w-]{10,200}$/.test(id)) return json({ error: 'Link di Google Drive non valido' }, 400);
  try {
    const action = url.searchParams.get('action');
    if (action === 'list') return json(await listFolder(id));
    if (action === 'file') return await downloadFile(id);
    return json({ error: 'Azione sconosciuta' }, 400);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});
