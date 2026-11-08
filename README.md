# AmpCloud

Lettore in streaming privato per un gruppo di amici: ognuno carica i brani che produce e gli altri li ascoltano dal browser, anche dal telefono. L'interfaccia è quella dei lettori desktop anni '90, disegnata da zero: lettore con display LCD e visualizzatore, equalizzatore a 10 bande, playlist, libreria condivisa e analizzatore (BPM, oscilloscopio, VU meter).

**Sito**: https://luigismith.github.io/handsynth/ampcloud/

## Cosa fa
- Account solo su invito; il primo iscritto è l'admin
- Caricamento dal dispositivo o da link di Google Drive, con compressione automatica in MP3 a 64 kbps nel browser
- Streaming con salto avanti/indietro, controlli dalla schermata di blocco, download dei brani
- Playlist condivise, ricerca, eliminazione dei duplicati, BPM rilevati e salvati per tutti
- Nessun server da gestire: sito statico su GitHub Pages + un progetto [Supabase](https://supabase.com) gratuito (account, database, file)

## Struttura
| Percorso | Contenuto |
|---|---|
| `ampcloud/` | il sito (HTML, CSS, JavaScript puro, nessuna build) |
| `ampcloud/config.js` | URL e chiave pubblica del progetto Supabase |
| `ampcloud/schema.sql` | tabelle, regole di sicurezza, inviti, storage |
| `ampcloud/supabase/functions/drive-import/` | funzione per l'import da Google Drive |
| `ampcloud/README.md` | guida completa: installazione, uso, limiti, problemi frequenti |
| `index.html` | reindirizza da `/` ad `ampcloud/` |
| `.github/workflows/pages.yml` | controlla il JavaScript e pubblica su GitHub Pages |

## Fare il proprio fork
Il fork parte collegato al progetto Supabase di questa repo. Per avere un AmpCloud tutto tuo:
1. **Fork** di questa repo su GitHub.
2. Crea un progetto gratuito su https://supabase.com, apri **SQL Editor** e incolla [`ampcloud/schema.sql`](ampcloud/schema.sql), poi imposta il tuo codice invito (`update public.app_settings set value = '…' where key = 'invite_code';`).
3. In Supabase: **Authentication → Sign In / Providers → Email**, disattiva **Confirm email**.
4. (Facoltativo, per l'import da Google Drive) **Edge Functions → Deploy a new function** con nome `drive-import` e il codice di [`ampcloud/supabase/functions/drive-import/index.ts`](ampcloud/supabase/functions/drive-import/index.ts).
5. Metti URL del progetto e chiave **publishable** (Project Settings → API Keys) in [`ampcloud/config.js`](ampcloud/config.js) e fai commit.
6. Nel fork: **Settings → Pages → Source: GitHub Actions**. Al prossimo push su `main` il sito è su `https://<tuo-utente>.github.io/<nome-repo>/ampcloud/`.
7. In Supabase, **Authentication → URL Configuration → Site URL**: metti quell'indirizzo (serve al link "Password dimenticata?").

I dettagli sono in [`ampcloud/README.md`](ampcloud/README.md).

## Licenza
MIT, vedi [LICENSE](LICENSE). Librerie incluse in `ampcloud/vendor/`: `@supabase/supabase-js` (MIT) e lamejs/LAME (LGPL-3.0), con le loro licenze accanto.
