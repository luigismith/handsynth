# AmpCloud

Il vostro lettore in streaming privato: ognuno carica i brani che produce e gli amici li ascoltano dal browser, anche dal telefono. L'interfaccia è quella dei lettori desktop anni '90: finestra principale con display LCD e visualizzatore, equalizzatore a 10 bande, playlist e libreria condivisa. Le finestre si trascinano e si agganciano tra loro.

- **Sito**: https://luigismith.github.io/handsynth/ampcloud/ (pubblicato da GitHub Pages a ogni push su `main`)
- **Dati**: un progetto [Supabase](https://supabase.com) gratuito, vostro. Contiene account, brani, playlist e il codice invito.

Il codice del sito è pubblico. I brani invece no: stanno in un bucket privato e si ascoltano solo con un account, tramite link temporanei (6 ore).

---

## Messa in funzione (circa 10 minuti, una volta sola)

### 1. Crea il progetto Supabase
1. Vai su https://supabase.com, accedi (va bene anche con GitHub) e premi **New project**.
2. Dagli un nome (es. `ampcloud`), scegli una password per il database (non ti servirà più) e come regione **Central EU (Frankfurt)**.
3. Aspetta un paio di minuti che il progetto sia pronto.

### 2. Crea le tabelle
1. Nel menu a sinistra apri **SQL Editor**, poi **New query**.
2. Incolla tutto il contenuto di [`schema.sql`](schema.sql) e premi **Run**. Si può rieseguire senza danni.
3. Sempre lì, imposta il vostro codice invito. Sceglilo lungo e difficile da indovinare:
   ```sql
   update public.app_settings set value = 'metti-qui-un-codice-lungo' where key = 'invite_code';
   ```

### 3. Togli la conferma via email
Il server email gratuito di Supabase manda messaggi solo ai membri del progetto, quindi gli amici non riceverebbero mai l'email di conferma.

**Authentication → Sign In / Providers → Email**: disattiva **Confirm email** e salva. Lascia attivo **Allow new users to sign up**: senza codice invito non si registra comunque nessuno.

### 4. Collega il sito al progetto
In **Project Settings → API Keys** (o **Data API**) copia:
- il **Project URL** (tipo `https://abcdefgh.supabase.co`)
- la chiave **publishable** (`sb_publishable_…`) oppure, nei progetti più vecchi, la **anon public** (`eyJ…`)

Poi hai due strade:
- **Consigliata**: scrivili in [`config.js`](config.js) (`supabaseUrl` e `supabaseAnonKey`) e fai commit su `main`. Il sito arriva già collegato per tutti.
- **Veloce**: apri il sito e incollali nella finestra **CONFIGURAZIONE**. Restano salvati solo in quel browser, ma il link invito (punto 6) li passa agli amici.

La chiave publishable/anon è fatta apposta per stare nel browser: i dati li proteggono le regole di sicurezza (RLS) di `schema.sql`. **Non usare mai** la chiave `service_role` o `secret`.

### 5. Registrati per primo
Apri il sito, scheda **Registrati**: email, password, nome utente e codice invito. **Il primo iscritto diventa admin.**

### 6. Invita gli amici
Menu **O** (in alto a sinistra nel lettore) → **Invita un amico…** → **Copia link**. Il link apre il sito già collegato al progetto e con il codice invito compilato: all'amico resta solo da scegliere email, nome e password.

Dallo stesso menu puoi cambiare il codice invito. I link vecchi smettono di funzionare, ma gli account già creati restano.

---

## Come si usa

| Cosa | Come |
|---|---|
| Caricare brani | Trascina i file sulla pagina, oppure il tasto ⏏ nel lettore o **+ CARICA** nella libreria. Formati: mp3, flac, wav, ogg, opus, m4a, aac, webm. Titolo e artista arrivano dai tag ID3/FLAC, altrimenti dal nome file `Artista - Titolo.mp3` |
| Ascoltare | Doppio clic su un brano della libreria o della playlist |
| Mandare un brano a un amico | Clic destro sul brano → **Copia link** (serve un account per ascoltarlo) |
| Playlist condivise | Pulsante **LIST** nella playlist: salva, apri, accoda. Le vedono tutti |
| Equalizzatore | **ON** lo attiva, **PRESET** carica o salva le curve, **AUTO** ricorda l'EQ di ogni brano |
| Modificare / eliminare | Clic destro sul brano in libreria. Ognuno gestisce i propri brani, l'admin tutti |
| Ridurre una finestra | Doppio clic sulla barra del titolo |
| Dimensione | Menu **O → Dimensione**, oppure il tasto **D** della barra laterale |

Scorciatoie: **X** play, **C** pausa, **V** stop, **Z/B** precedente/successivo, **←/→** ±5 s, **↑/↓** volume, **S** casuale, **R** ripeti, **L** carica, **J** cerca. Su telefono le finestre si impilano in colonna, e la riproduzione continua a schermo spento con i controlli nella schermata di blocco.

---

## Limiti del piano gratuito di Supabase
- **50 MB per file**. Un mp3 a 320 kbps ne usa circa 2,4 al minuto. Per WAV o FLAC lunghi conviene convertire prima:
  ```bash
  ffmpeg -i brano.wav -b:a 320k brano.mp3
  ```
- Spazio e traffico mensile sono limitati (circa 1 GB di file). I numeri attuali sono su https://supabase.com/pricing, l'occupazione in **Project Settings → Usage**.
- **I progetti gratuiti vanno in pausa dopo una settimana senza attività.** Si riattivano dalla dashboard con **Restore project**: i dati restano.

## Problemi frequenti
- **"Registrazione rifiutata"**: codice invito sbagliato o nome utente già preso. Il codice si controlla dal SQL Editor: `select * from app_settings;`
- **"Devi prima confermare l'email"**: non hai fatto il punto 3.
- **"Il database non è configurato"**: non hai eseguito `schema.sql` (punto 2).
- **Ho perso la password**: l'admin la reimposta da **Authentication → Users** nella dashboard di Supabase.
- **Voglio cambiare l'admin**: `update profiles set is_admin = true where username = 'nome';`

## File
| File | Contenuto |
|---|---|
| `index.html`, `css/`, `js/` | il sito (JavaScript puro, nessuna build) |
| `config.js` | URL e chiave pubblica del vostro progetto Supabase |
| `schema.sql` | tabelle, regole di sicurezza, inviti, storage |
| `vendor/supabase-2.117.0.js` | libreria ufficiale `@supabase/supabase-js` (licenza MIT, vedi `vendor/supabase-LICENSE.txt`) |

La grafica è disegnata da zero in CSS e canvas, senza skin o loghi di altri programmi.
