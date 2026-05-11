# HandSynth — Manuale Utente

## Benvenuto

HandSynth è un **sintetizzatore gestuale per live performance** che si suona
con il corpo. Muovi le mani, gira la testa, apri la bocca, sorridi, aggrotta
le ciglia, punta, swipa: ogni movimento entra a far parte del suono. Non ci
sono tasti da imparare, né scale da memorizzare. Il cervello musicale dentro
l'app rimane sempre nella tonalità attiva, quindi è genuinamente impossibile
suonare una nota sbagliata. Il tuo lavoro è sentire.

Pensato per il palco: un laptop, una webcam, e le tue mani. Output dalle casse
del laptop, da un'interfaccia USB audio, o instradato via BlackHole dentro un
DAW per mix e registrazione. La guida di installazione per macOS — Gatekeeper,
routing audio, e tips per il palco — è in [`INSTALL.it.md`](./INSTALL.it.md).

L'estetica è cyberpunk per scelta. Arancione su antracite, scheletri low-poly,
una scia di scanline sottile sopra i pannelli. Questo manuale percorre ogni
gesto, ogni pannello, ogni scorciatoia da tastiera, e qualche suggerimento di
troubleshooting per quando le cose vanno storte.

## Primo avvio

Quando apri HandSynth per la prima volta, al centro compare una piccola card
arancione che chiede il permesso di usare la webcam. Clicca su **Permetti
webcam e iniziare**. Il browser ti chiederà il permesso per la fotocamera:
accettalo.

Se il permesso viene negato o non c'è una fotocamera disponibile, l'app entra
in **modalità autopilot**: un flusso sintetico di gesti vaga lentamente fra
densità e tonalità in modo che tu possa comunque ascoltare come suona HandSynth
senza una webcam. Un piccolo toast in basso ti dice in quale modalità sei
finito.

Quando la card di onboarding sparisce dovresti sentire un breve accordo di Do
maggiore (il test di boot) e vedere il visualizer accendersi. Alza le mani
verso la fotocamera e lo scheletro del visualizer le aggancia.

## Controlli base (mani)

Queste sono le mappature delle mani sempre attive. Ognuna è continua: nessuna
soglia, nessun on/off. Muoviti lentamente per sentire il parametro scivolare.

| Gesto | Effetto audio | Range |
|---|---|---|
| Distanza fra le mani (3D) | Cutoff filtro master | da 200 Hz a 12 kHz, curva log |
| Altezza media delle mani | Densità note e luminosità | da quarti a sedicesimi, da scuro a brillante |
| Apertura palmo destro | Riverbero wet e feedback delay | da asciutto a lavato |
| Apertura palmo sinistro | Drive saturatore e Q risonanza filtro | da pulito a urlante |
| Pinch destro (pollice-indice) | Innesca uno stab lead consapevole dell'armonia | one-shot |
| Pinch sinistro | Avanza al prossimo accordo della progressione | one-shot |
| Entrambi i pugni chiusi | Master mute (si rilascia all'apertura) | toggle |
| Entrambe le mani sopra la testa | Il "drop" — riverbero massimo, filtro spalancato | tenuto |

**Nota sui pinch.** Il pinch è un evento sul fronte di salita: avvicina le punte
di pollice e indice. Il mapper applica un debounce ai re-pinch entro 120 ms in
modo che un gesto goffo non spari due volte.

**Nota sui pugni.** "Entrambi i pugni" significa entrambe le mani chiuse
contemporaneamente. Utile per uno stop improvviso: puoi pugnalare il silenzio
dentro una frase chiudendo di scatto i pugni.

## Controlli 3D

HandSynth legge anche la profondità. Questi controlli si stratificano sopra le
mappature base.

| Gesto | Effetto audio | Note |
|---|---|---|
| Profondità mano (Z medio) | Volume master | Più vicino alla camera = più forte |
| Roll palmo destro | Fine-tune luminosità | Più o meno 0,15 |
| Roll palmo sinistro | Fine-tune drive saturatore | Più o meno 0,4 |
| Pitch medio dei palmi | Fine-tune feedback delay | Più o meno 0,15 |

Il "roll" è quando ruoti il polso intorno all'asse dell'avambraccio: palmo in
giù — palmo in su. Il "pitch" è inclinare il palmo avanti e indietro, dita
verso e dalla camera.

## Controlli per singolo dito

HandSynth legge ogni dito in modo indipendente. Oltre all'"apertura"
aggregata di una mano intera, ogni singolo dito emette uno scalare di curl
continuo 0..1 (0 = completamente esteso, 1 = completamente piegato) che
guida la propria dimensione audio.

Il livello per-dito è **additivo sopra la mappatura aggregata di apertura**
con un peso del 35%: una mano completamente estesa suona come prima, ma
piegare un singolo dito produce un cambio audibile su una dimensione
specifica. La sensibilità è tarata alta (One-Euro `beta=0.08`, il doppio
dello smoothing scalare standard) così piccoli movimenti deliberati si
registrano.

### Mano destra — la mano FX

| Dito | Effetto audio | Range (esteso → piegato) |
|---|---|---|
| Pollice | Feedback delay | 0,7 ripetizioni bagnate → 0,1 secco |
| Indice | Cutoff filtro (log) | 14 kHz brillante → 600 Hz scuro |
| Medio | Riverbero wet | 0,85 hall → 0,05 asciutto |
| Anulare | Offset luminosità | +0,15 → −0,15 (additivo) |
| Mignolo | Delay wet | 0,6 → 0,05 |

### Mano sinistra — la mano drive

| Dito | Effetto audio | Range (esteso → piegato) |
|---|---|---|
| Pollice | Drive saturatore | 2,6 grit → 0,8 pulito |
| Indice | Q risonanza filtro | 12 → 1,5 |
| Medio | Riverbero wet (livello extra) | 0,7 → 0,05 |
| Anulare | Offset volume master | +0,10 più forte → −0,10 più piano |
| Mignolo | Profondità tremolo (LFO luminosità 5 Hz) | 0 → 1 |

**Nota di calibrazione.** Il curl per-dito usa la geometria del dito
(rapporto tra distanze tip-PIP-MCP) anziché la posizione assoluta, perciò
funziona indipendentemente dalla dimensione della mano o dalla distanza
dalla camera. Se un dito non sembra registrare, esagera il movimento
piegandolo oltre l'articolazione PIP, poi estendilo completamente — la
calibrazione vede tutto il range.

**Nota sui livelli.** Poiché ogni dito mappa a un parametro unico, puoi
"suonare" l'audio come uno strumento. Prova: tieni la mano destra
prevalentemente aperta, poi piega solo il medio — sentirai il riverbero
cadere mentre tutto il resto resta fermo. Oppure piega il mignolo sinistro
per aggiungere un wobble di tremolo costante.

## Controlli del viso

Il livello del viso è additivo. Quando il FaceTracker vede il tuo volto, tutte
le mappature qui sotto modulano il suono già guidato dalle mani.

| Gesto | Effetto audio | Visual |
|---|---|---|
| Dimensione apparente del viso | Blend riverbero wet | più vicino = più asciutto |
| Roll della testa (inclinazione) | Offset luminosità, più o meno 0,15 | — |
| Yaw della testa (rotazione) | Offset Q risonanza filtro, più o meno 5 Q | — |
| Pitch della testa (mento in su) | Boost densità note | — |
| Bocca aperta | Sweep delay wet, cutoff filtro +6k, riverbero +0,3, luminosità +0,4 | particelle dalla bocca |
| Bocca aperta (fronte di salita) | Stab lead chord-tone | — |
| Sorriso | Luminosità +0,2, masterDuck ridotto di 0,15 | (il suono si schiarisce, viene avanti) |
| Cipiglio | Cutoff filtro tirato verso 1,5 kHz | (il suono si scurisce) |
| Sorpresa (mascella + sopracciglia su) | Riverbero +0,3, feedback delay +0,1 | (il suono si apre) |
| Rabbia (sopracciglia giù, niente sorriso) | Drive +0,6, Q filtro +5 | (il suono spunta e graffia) |
| Viso perso > 1,5 s | Master ducka di +0,15 | — |

**Nota di calibrazione per le espressioni.** I quattro scalari delle espressioni
arrivano dagli output blendshape di MediaPipe. Saturano vicino a 1,0 su una
espressione chiara e deliberata. Un sorriso sottile si registra a circa 0,3 e
contribuisce in proporzione. Se un'espressione non scatta, esagerala: punta il
viso verso la camera, mantieni l'espressione per mezzo secondo.

## Cheat sheet dei gesti

L'interprete dei gesti discreti riconosce 12 forme statiche della mano e 5
gesti di velocità. Ognuno spara un'azione musicale one-shot. L'interprete è
volutamente conservativo: ogni forma deve tenere per tre frame consecutivi
prima di contare, e lo stesso gesto non può ri-sparare entro la sua finestra
di cooldown. Meglio mancare un gesto deliberato che spararne uno non voluto.

### Forme statiche della mano

| Forma | Mano | Effetto |
|---|---|---|
| Punta | destra | Spike Q filtro — focus secco, decade in 600 ms |
| Pace (V) | destra | Pulse di luminosità (approssimazione vibrato shimmer) |
| Rock on (corna) | destra | Manopola distorsione su — drive +0,35 per 1,5 s |
| OK (anello) | destra | Flutter nastro — feedback delay +0,2 per 1 s |
| Pistola (forma a L) | destra | Stab lead chord-tone |
| Pollice su | destra | Salva quick-patch (loggato in console) |
| Pollice giù | destra | Reset al preset di fabbrica INIT |
| Tre (I+M+A) | destra | Applica il preset di fabbrica slot 3 (ACID) |
| Quattro (I+M+A+M) | destra | Applica il preset di fabbrica slot 4 (DUB) |
| Call me (shaka) | destra | Percussione one-shot |
| Pugno | entrambe | (Gesto di velocità — vedi sotto) |
| Palmo aperto | entrambe | Reset / nessuna azione speciale (rilascia le forme tenute) |

### Gesti di velocità

| Gesto di velocità | Mano | Effetto |
|---|---|---|
| Snap (estensione veloce dell'indice) | entrambe | Percussione one-shot |
| Swipe a destra | destra | Prossimo preset PATCH di fabbrica |
| Swipe a sinistra | destra | Preset PATCH di fabbrica precedente |
| Pugno verso il basso (entrambe le mani, veloce) | entrambe | Drop bomba — feedback delay +0,3 + riverbero +0,3 per 1,5 s |
| Wave (oscillazione S-D, ≥3 inversioni in 1,2 s) | entrambe | Tremolo (LFO luminosità a 5 Hz) |

### Suggerimenti per i gesti discreti

- **Tieni la forma brevemente.** L'interprete richiede tre frame identici
  (~125 ms a 24 Hz) prima di committare: il flicker fra forme simili viene
  scartato.
- **Aspetta un tempo fra i fire.** Ogni forma ha un cooldown di 350 ms; lo
  snap ne ha 250 ms; lo swipe 600 ms. Sparare gesti uno dietro l'altro
  spamma il cooldown, non il motore audio.
- **Lo snap richiede curl-poi-extend.** Passare da un pugno chiuso a un indice
  aperto in un movimento veloce lo fa scattare. Un'estensione lenta non
  qualifica.
- **Gli swipe richiedono velocità sostenuta.** Un blip attraverso il frame
  non scatena nulla: devi mantenere il movimento per almeno 150 ms.
- **Il wave è continuo.** Una volta che inizi a salutare, la luminosità
  oscilla finché continui ad oscillare. Fermare il movimento dissolve
  l'oscillazione.

## Vibe

Quattro vibe predefiniti settano tonalità, BPM e firma timbrica. Clicca un
chip in cima allo schermo, oppure apri l'editor PATCH e usa il dropdown Vibe.

- **Tycho** — pad luminosi, ariosi, modali. Tempo medio (~92 BPM). Default.
- **Bonobo** — bass caldo, organico, rotolante. Lievemente più lento, mood
  downtempo.
- **Hopkins** — spettrale, evolutivo, drone-pesante. Mood da colonna sonora.
- **Floating Points** — punchy, tempo da club, più enfasi ritmica.

Cambiare vibe fa il crossfade del motore: non devi smettere di suonare.

## Preset PATCH

Clicca l'icona ad ingranaggio in alto a destra (oppure premi `p`) per aprire
l'editor PATCH. In cima c'è una fila di otto chip di fabbrica:

- **LUSH** — riverbero ampio, saturatore morbido, movimento lento
- **ACID** — risonanza alta, envelope veloci, drive che morde
- **DUB** — delay lungo, basso che ducka, spazio fumoso
- **BRIGHT** — filtro spalancato, alta luminosità, alti frizzanti
- **DARK** — cutoff basso, luminosità bassa, atmosfera meditabonda
- **TAPE** — saturazione gentile, wobble di tono, sapore vintage
- **SPACE** — riverbero massimo, ambient pad-forward
- **INIT** — default puliti; parti da zero qui

Clicca un chip per applicarlo all'istante. Le manopole sotto mostrano lo stato
corrente e sono completamente editabili: trascina una manopola verticalmente
per cambiarne il valore.

Per salvare la tua patch: scrivi un nome nel box in basso, premi **Salva**.
Le tue patch persistono in `localStorage` e ricompaiono nella sessione
successiva. Clicca **Carica** su una riga per richiamarla; **Elim** per
rimuoverla.

Il pulsante **Ripristina vibe** riporta ogni manopola ai default del vibe
attivo senza perdere le patch salvate.

### Sezione Voce — scegli una forma d'onda E falla morphare

Sotto le manopole FX principali c'è una sezione **Voce** con una riga per
ogni voce. Ogni riga ha due controlli affiancati:

- Un **dropdown forma d'onda** — scegli l'oscillatore lato A per quella
  voce fra 13 opzioni: `SINE`, `TRIANGLE`, `SAWTOOTH`, `SQUARE`, `PULSE`,
  `FAT SINE`, `FAT TRIANGLE`, `FAT SAWTOOTH`, `FAT SQUARE`, `FM SINE`,
  `FM SAWTOOTH`, `AM SINE`, `AM SAWTOOTH`. È il *vero* selettore di forma
  d'onda — fa quello che ti aspetti, indipendentemente dalla manopola di
  morph.
- Una manopola **Mix** — crossfade fra la forma d'onda lato A e una
  destinazione lato B fissa (sinusoide per il pad, pulse per il lead,
  triangola per il basso). 0 = solo A, 1 = solo B, 0.5 = mix bilanciato.
  Crossfade a potenza costante quindi il morph è fluido — il feeling
  della manopola "WAVE" analogica, mai brusco. Entrambi gli stack di
  oscillatori suonano sempre; il crossfade controlla solo l'udibilità,
  così il morph a metà nota scivola tra i due timbri invece di stacchettare.

Come il dropdown interagisce con vibe e preset di fabbrica:

- Cliccare un chip **preset di fabbrica** (LUSH / ACID / DUB / …) è un
  apply one-shot completo — la forma d'onda del preset per ogni voce
  sostituisce quella nel dropdown. È voluto: i chip sono "dammi questo
  suono intero", non "preserva le mie scelte".
- Cambiare il dropdown **vibe** azzera anche le forme d'onda scelte
  (il vibe è un'identità sonora intera).
- Cambiare solo il **dropdown forma d'onda** sostituisce l'oscillatore
  lato A e lascia ogni altra manopola al suo posto (FX, inviluppi, mix).
- Le scelte vengono salvate nelle patch utente: le tue patch salvate
  ricordano esattamente quale forma d'onda hai scelto, per ogni voce.

### Pill SMART — router di voicing intelligente

A destra dell'intestazione della sezione **Voce** c'è una piccola pill
**SMART**, **ON di default**. Quando è attiva, HandSynth sposta il
`timbre` di ogni voce verso una destinazione musicalmente sensata in
base allo stato degli FX:

| Condizione | Spostamento | Motivo |
|---|---|---|
| Cutoff filtro < 800 Hz | pad → +0.15 verso sinusoide; basso → -0.15 (mantiene armoniche) | filtro scuro vuole un pad pulito e un basso presente |
| Cutoff filtro > 10 kHz | lead → -0.15 (verso oscillatore ricco di armoniche) | filtro brillante ha bisogno di armoniche |
| Drive > 2.0 | tutte le voci → -0.15 (verso lato A) | il saturatore vuole armoniche su cui mordere |
| Drive < 1.0 | tutte le voci → +0.15 (verso sinusoide/pulse/triangola) | drive pulito vuole un tono morbido |
| Q filtro > 8 | lead → +0.15 (verso pulse) | Q risonante + pulse = honk vocale |
| Riverbero > 0.7 | pad → +0.15 (verso sinusoide) | la sinusoide si lava bene nel riverbero |

Ogni regola contribuisce al massimo ±0.15 e il totale per ogni voce è
clampato a ±0.15 — il router è una spinta sottile, **mai un override**.
La tua manopola resta il segnale dominante. Clicca la pill SMART per
disattivare il router e sentire solo il timbro impostato a mano.

## Tonalità & scala

Il motore armonico del synth suona in tonalità + scala (es. Do minore, Fa#
lidio). Di default ogni vibe arriva con la sua scala preferita, ma puoi
sovrascriverla indipendentemente da BPM, voicing e FX del vibe.

Apri l'**editor PATCH** (icona ad ingranaggio in alto a destra, oppure `p`)
e cerca i dropdown **TON** e **SCALA** sopra la griglia delle manopole.

- **Tonalità** — la nota di radice. Dodici opzioni: `C`, `C# / Db`, `D`,
  `D# / Eb`, `E`, `F`, `F# / Gb`, `G`, `G# / Ab`, `A`, `A# / Bb`, `B`.
- **Scala** — Maggiore (Ionica), Minore (Eolia), Minore Armonica, Minore
  Melodica, Dorica, Frigia, Lidia, Misolidia, Locria, Pentatonica
  Maggiore, Pentatonica Minore, Blues, Cromatica.

Cambiare l'una o l'altra fa snappare ogni nota generata di lead e bass alla
nuova scala. La progressione di accordi rimane come l'ha scritta il vibe,
così conservi il carattere del brano: il filtro snap-to-consonance del
cervello musicale ri-armonizza graziosamente qualsiasi chord-tone fuori
scala, così puoi suonare la progressione di Bonobo in Do minore (o
qualsiasi altra cosa) senza che suoni sbagliato.

Premi il pulsantino **↺** alla destra dei dropdown per riportare entrambi
ai default del vibe attivo.

La tua selezione è sticky: persiste fra cambi di vibe per il resto della
sessione, ed è ricordata in `localStorage` fra le sessioni. Il pulsante di
reset cancella l'override salvato.

## Scorciatoie da tastiera

Tutte le scorciatoie sono lettere o tasti funzione/controllo, così rimangono
nella stessa posizione fisica su ogni layout di tastiera internazionale (US,
IT, FR, DE, ecc.). Nessuna dipendenza da tasti simbolo.

| Tasto | Azione |
|---|---|
| `t` | Apri/chiudi il terminale eventi (lato sinistro) |
| `p` | Apri/chiudi l'editor PATCH |
| `h` o `F1` | Apri/chiudi questo pannello di aiuto |
| `m` | Inverti il mirror selfie |
| `Escape` | Silenzia / riattiva l'audio (STOP) |

Quando il pannello di aiuto o l'editor patch è aperto, `Escape` chiude prima
il pannello; premilo di nuovo per silenziare.

## Controlli HUD

Nell'angolo in basso a destra vedi tre piccoli pulsanti icona:

- **Power (⏻)** — STOP. Clicca una volta per silenziare l'audio. Clicca di
  nuovo per riattivarlo. Quando è silenziato, l'icona si illumina di
  arancione così te ne accorgi a colpo d'occhio.
- **Terminale (⌐)** — apri/chiudi il log eventi traslucido sul lato sinistro.
  Utile per vedere esattamente quali note e gesti stanno scattando in tempo
  reale.
- **Aiuto (?)** — apri/chiudi questo manuale.

La fila è volutamente piccola e traslucida così non blocca mai il visualizer
dietro. Tutti e tre i pulsanti hanno scorciatoie da tastiera (vedi sopra) se
preferisci non usare il mouse.

A loro fianco c'è anche un piccolo **selettore di lingua** (IT / EN): un
tap lo cambia all'istante e ogni pannello si ridisegna nella nuova lingua.
La scelta è ricordata in `localStorage`.

## Suggerimenti

- **Calibrazione.** Sorrisi, cipigli ed espressioni di rabbia si registrano a
  valori frazionari: non aspettarti che un sorrisetto faccia girare la
  lampadina di luminosità. Tieni l'espressione per mezzo secondo così il
  filtro One-Euro la prende.
- **Silenziare velocemente.** `Escape` silenzia tutto. `Entrambi i pugni
  chiusi` fa la stessa cosa lato gesto, con una dissolvenza di 200 ms.
- **Glitch audio.** Se senti crackling, prova `pnpm preview` invece di
  `pnpm dev`. La build di produzione è molto più leggera sul main thread; il
  dev server di Vite aggiunge overhead HMR che può affamare lo scheduler
  audio.
- **Tempo di caricamento di MediaPipe.** Il primo avvio scarica ~10 MB di
  modelli MediaPipe da una CDN. I caricamenti successivi sono in cache.
- **Webcam pre-mirrorata.** Alcune fotocamere virtuali (OBS, Snap Camera)
  passano a HandSynth uno stream già mirrorato. Se lo scheletro della tua
  mano cade sul lato sbagliato dello schermo, premi `m` per invertirlo.

## Troubleshooting

**Webcam non rilevata.** Il prompt di permesso del browser potrebbe essere
stato dismesso. Ricarica la pagina: il prompt ricompare quando clicchi il
pulsante di onboarding. Se è negato a livello sistema operativo (Windows
Privacy → Camera, oppure macOS System Settings → Camera), concedi l'accesso
e ricarica.

**Niente audio.** L'audio richiede un gesto utente per partire (il click di
onboarding). Se sei passato oltre l'onboarding e non senti ancora niente,
clicca da qualche parte nella finestra: alcuni browser sospendono l'AudioContext
sul cambio tab. La barra di stato del terminale HUD mostra lo stato corrente
del context (running / suspended).

**Audio glitchato / che droppa.** Chiudi le altre tab che fanno webcam o
audio in tempo reale (Zoom, Meet, Discord con video acceso, ecc.). HandSynth
condivide il main thread con due modelli MediaPipe e uno sketch p5.js.

**Gesti in ritardo.** Controlla la riga CTX del terminale HUD. Se mostra
`suspended`, l'audio context è stato deprioritizzato: clicca da qualche parte
per risvegliarlo.

## Crediti / licenza

Costruito con [Claude Code](https://claude.com/claude-code). Motore audio
realizzato con [Tone.js](https://tonejs.github.io/). Tracking di mani e
viso via [MediaPipe Tasks Vision](https://developers.google.com/mediapipe).
Visualizer in [p5.js](https://p5js.org/). Smoothing per gentile concessione
del filtro One-Euro (Casiez, Roussel, Vogel — CHI 2012).

Licenza MIT — vedi [`LICENSE`](./LICENSE). Usalo, forkalo, installalo sulle
macchine dei tuoi amici, fai un live show, costruici sopra qualcosa. Citare
è apprezzato ma non richiesto.
