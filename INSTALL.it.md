# HandSynth — Installazione e avvio

> 🇬🇧 [English version →](./INSTALL.md)

HandSynth è uno **strumento gestuale per live performance**. Si esegue in tre modi:

1. **Web (consigliato per il palco)** — `pnpm dev` o `pnpm preview` in una finestra desktop di Chrome / Edge / Safari. Overhead minimo, avvio rapidissimo, riavviabile a metà show se qualcosa va storto.
2. **App desktop** — binario Electron pacchettizzato (`.dmg` su Mac, `.exe` su Windows). Leggermente più pesante ma vive nel dock e gira offline una volta installato.
3. **Da sorgente** — per modificare, buildare, o contribuire.

Questa guida copre **macOS** dall'inizio alla fine. Utenti Windows: vedi la [release page v0.2.0](https://github.com/luigismith/handsynth/releases/tag/v0.2.0) per l'installer `.exe` pre-buildato, oppure seguite la stessa procedura `pnpm install` / `pnpm dev`.

---

## Quick start (web — niente install, solo clone)

Se vuoi solo suonare, la modalità web è la via più veloce. Niente build Electron, niente DMG, niente firma del codice.

### Prerequisiti

Servono tre cose sul tuo Mac:

- **macOS 12 Monterey o superiore** (le versioni precedenti non hanno un Safari compatibile con Tone.js)
- **Node 20+** — verifica con `node -v`
- **pnpm 9.15+** — verifica con `pnpm -v`

Se non hai Node, installalo via [nvm](https://github.com/nvm-sh/nvm):

```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
# riavvia il terminale, poi:
nvm install 20
nvm use 20
```

Se non hai pnpm:

```sh
npm install -g pnpm@9.15.0
```

### Clone e avvio

```sh
git clone https://github.com/luigismith/handsynth.git
cd handsynth
pnpm install
pnpm dev
```

Apri **http://localhost:5173** in Chrome, Edge o Safari. Clicca il bottone arancione **PERMETTI WEBCAM E INIZIARE** (oppure **ALLOW WEBCAM AND BEGIN** se il browser è in inglese — la UI auto-rileva la locale). Alza le mani.

Questa è tutta l'installazione. Tutto è bundlato — Tone.js, MediaPipe, p5.js, il music brain. Niente Docker, niente Python, nessun driver audio da configurare.

### Per uso live

Una volta verificato che `pnpm dev` funziona, usa questo comando durante lo show vero e proprio:

```sh
pnpm preview
```

Questo serve la **build di produzione** — niente overhead di Vite HMR, più leggero sul main thread, molto più stabile per un set lungo. Esegui `pnpm build` una volta prima, poi `pnpm preview` per ogni avvio successivo.

Rituale pre-show:

```sh
git pull          # se stai pullando nuove feature in tour
pnpm install      # solo se le dipendenze sono cambiate
pnpm build        # produce dist/
pnpm preview      # serve dist/ su http://localhost:4173
```

Fai sempre un sound check di 30 secondi sulla macchina vera dello show + luci + webcam prima di andare live.

---

## Build app desktop (`.dmg`)

La build desktop Electron impacchetta l'app web in una finestra nativa. Utile se vuoi HandSynth nel dock del Mac, o se la rete del venue blocca le app localhost-style.

### Prerequisiti

Oltre a Node + pnpm:

- **Xcode Command Line Tools** — `xcode-select --install` (le dep native di Electron servono questo)
- Circa **2 GB di spazio libero** per la cache di build Electron

### Build sia arm64 che x64

```sh
pnpm electron:build:mac
```

Questo produce due file DMG in `release/`:

- `HandSynth-0.x.0-arm64.dmg` — Apple Silicon (M1 / M2 / M3 / M4)
- `HandSynth-0.x.0-x64.dmg` — Mac Intel

Scegli quello che corrisponde alla tua macchina. Doppio click sul DMG, trascina **HandSynth** in Applicazioni.

### Primo avvio — warning "sviluppatore non identificato"

Il DMG **non è firmato** con un certificato Apple Developer (HandSynth è un progetto open source gratuito, non un'app dell'App Store). La prima volta che lo apri, macOS lo blocca.

Per autorizzarlo:

1. Prova ad aprire l'app una volta — macOS si rifiuta e mostra il dialog Gatekeeper
2. Apri **Impostazioni di Sistema → Privacy e Sicurezza**
3. Scorri fino alla sezione **Sicurezza** — vedrai "HandSynth non è stato aperto perché non proviene da uno sviluppatore identificato"
4. Clicca **Apri comunque**
5. Conferma il dialog che appare

Devi farlo solo una volta per installazione. Dopo HandSynth si apre normalmente.

Se preferisci la riga di comando:

```sh
xattr -dr com.apple.quarantine /Applications/HandSynth.app
```

Questo rimuove il flag di quarantena e salta il dialog.

### Permesso webcam

La prima volta che HandSynth chiede la webcam, macOS mostra un permission prompt. **Clicca Consenti**. Se per sbaglio hai cliccato Nega, sistema da **Impostazioni di Sistema → Privacy e Sicurezza → Fotocamera** — attiva HandSynth.

Se non vedi HandSynth nella lista Fotocamera, la grant del permesso non è stata registrata. Esci dall'app, riavviala e ritrigga la richiesta della camera.

### Modalità dev (live reload)

Per sviluppare o modificare il sorgente contro la finestra desktop:

```sh
pnpm electron:dev
```

Questo avvia Vite + Electron con HMR — le tue modifiche in `src/` si applicano immediatamente nella finestra app in esecuzione. Non usarlo sul palco; usa `pnpm preview` invece.

---

## Build da sorgente (qualunque piattaforma)

Stessa cosa del flusso web sopra — `pnpm dev` è l'esperienza da-sorgente. L'unica differenza rispetto al repo clonato è che tipicamente faresti branch off, commit, push.

```sh
git clone https://github.com/luigismith/handsynth.git
cd handsynth
pnpm install
pnpm typecheck          # tsc strict — 0 errori attesi
pnpm lint               # 0 errori (3 warning preesistenti in src/visual/ ok)
pnpm exec vitest run    # unit + integration test — devono passare tutti
pnpm build              # produce dist/
pnpm preview            # serve dist/
```

Il workflow CI in `.github/workflows/ci.yml` esegue tutti e quattro i gates su ogni push e pull request. Se i tuoi gates locali passano, anche CI passa.

---

## Routing audio per live show

Web Audio di default va sull'output di sistema (qualunque casse o interfaccia audio stia usando il tuo Mac). Per mandare HandSynth in un mixer o DAW per monitoring + recording, usa un device audio virtuale.

### BlackHole (gratis, consigliato)

[BlackHole](https://existential.audio/blackhole/) è un cavo audio virtuale macOS gratuito.

1. Installa BlackHole 2ch (o 16ch se ti servono più canali)
2. In **Configurazione MIDI Audio**, crea un **Device Aggregato** che combina il tuo output reale (interno o interfaccia USB) + BlackHole
3. Imposta l'output di sistema del Mac sul device aggregato
4. Nel tuo DAW (Logic, Ableton, Reaper, ecc.) seleziona BlackHole come input

L'output di HandSynth ora è sia udibile sulle casse SIA una traccia nel DAW per recording / processing.

### Loopback (pagamento, GUI più semplice)

Se vuoi un tool con GUI, [Loopback di Rogue Amoeba](https://rogueamoeba.com/loopback/) fa la stessa cosa con un'interfaccia più amichevole.

---

## Scelta webcam per palco

I modelli di tracking mani e viso funzionano con qualunque webcam, ma la qualità conta più della risoluzione:

- **Camera MacBook integrata** — ok per test, leggermente soft per palco se il venue è in penombra
- **Webcam USB (Logitech C920 / Brio / simili)** — consigliata per show. FOV più ampio, low-light migliore, l'autofocus si blocca più velocemente
- **Camera cinema esterna via HDMI capture** — funziona (HandSynth non si cura della sorgente) ma la latenza di capture varia; testa prima dello show
- **Phone-as-webcam (Camo, Iriun, ecc.)** — funziona ma aggiunge ~30-80 ms di latenza che si nota su gesti ritmici. Ok per gioco texturale, meno ok per stab snappy

Posiziona la camera in modo che le tue mani siano chiaramente in frame quando le braccia sono fuori. Il viso serve visibile solo per il detector di bocca/espressioni — dal mento alle sopracciglia basta.

---

## Troubleshooting

### L'overlay "Webcam negata" non va via

Controlla **Impostazioni di Sistema → Privacy e Sicurezza → Fotocamera** e attiva HandSynth (o il tuo browser). Esci e riavvia l'app — il permesso si applica solo al prossimo avvio.

### Audio glitchato o che droppa

La causa più comune è l'overhead dell'HMR del dev server sul main thread. Passa a modalità production:

```sh
pnpm build
pnpm preview
```

Se i glitch persistono anche in preview, chiudi altre app che usano camera o audio (Zoom, Meet, Discord, OBS). L'inference MediaPipe + scheduler Tone.js di HandSynth hanno bisogno del main thread ragionevolmente libero.

### La pagina si è piantata a metà set

È un'issue nota sotto carico prolungato pesante — l'event loop JS può starvare quando MediaPipe + Tone.js + p5.js + InteractionMapper condividono tutti il main thread. Le mitigazioni sono in place ma la root cause (niente offload su Web Worker per MediaPipe — issue di compatibilità Vite) non è completamente risolta.

Se succede sul palco:

1. **Apri il Terminal HUD** (premi `t`) prima di andare live — la riga DIAG mostra `subs/lines/voices/q/at`. Guarda la crescita monotona di `voices` o `q` nei minuti — è il segnale di leak
2. **Tieni una seconda tab pre-warmata** — se la tab attiva freeza in mezzo a un pezzo, `Cmd+Tab` sulla backup
3. **Usa l'app Electron** se i freeze web succedono spesso — ha il suo processo dedicato e isola l'audio context dalle estensioni browser

### Il download del modello MediaPipe si blocca al primo avvio

I modelli mani + viso (~10 MB) scaricano da `storage.googleapis.com` al primo lancio. Alcuni venue bloccano GCS. Workaround:

- Pre-warma il laptop a casa con i modelli in cache
- La cache del browser sopravvive ai riavvii di `pnpm preview` — una volta caricata la pagina con internet, non ti serve internet dopo

### Il warning Gatekeeper / code-signing non va via

Vedi la sezione **Primo avvio** sopra — `xattr -dr com.apple.quarantine /Applications/HandSynth.app` è la one-liner.

### Audio troppo silenzioso attraverso il DAW

L'output Web Audio attraverso BlackHole è a livello linea. Se l'input gain del DAW è a 0 dB, aspettati di dover dare +6 fino a +12 dB di gain sulla traccia. Comprimi leggermente per uniformare la dinamica dei gesti.

---

## Tips per live performance

- **Sound check 30 minuti prima delle porte** — calibra il range di openness, la soglia di pinch, e la posizione del viso con la luce reale del palco. L'accuratezza del tracking dipende dalla luce.
- **Bind uno shortcut panic sul palco** — `Escape` silenzia l'audio istantaneamente. Entrambi i pugni chiusi fanno lo stesso lato gesto. Esercita questi gesti finché diventano memoria muscolare.
- **Pre-seleziona scala e vibe** — apri il PATCH editor (`p`), scegli KEY + SCALE + factory preset, e salva il patch. Richiamalo da `localStorage` al prossimo avvio.
- **Non cambiare la tua posizione di partenza a metà brano** — il filtro One-Euro si calibra sui primi frame; se ti sposti drasticamente, lo smoothing può laggare il cambio di 100-200 ms.
- **Pianifica per il freeze** — vedi Troubleshooting. Tieni sempre una tab di backup aperta. Un gap di silenzio di 5 secondi è recuperabile a metà brano; un gap di 60 secondi con tab crashata non lo è.
- **Registra tutto** — anche le prove. HandSynth è uno strumento generativo; alcune delle tue frasi migliori saranno impossibili da ripetere.

---

## Servono aiuto

Apri un issue su https://github.com/luigismith/handsynth/issues. Includi:
- Versione macOS (`sw_vers`)
- Versione Node (`node -v`)
- Browser + versione (o "Electron build")
- Esattamente quale gesto / azione ha triggato il problema
- Output console (`Cmd+Opt+I` → tab Console — ultime 20 righe)

Se l'issue è webcam o audio, allega uno screenshot del pannello Privacy delle Impostazioni di Sistema rilevante.
