// Configurazione del sito. Compila questi due valori con quelli del VOSTRO
// progetto Supabase (Project Settings → API) e fai commit: così gli amici
// trovano il sito già collegato. La chiave "anon"/"publishable" è pubblica per
// design: i dati sono protetti dalle regole RLS di schema.sql.
// Se li lasci vuoti, il sito chiede i valori al primo avvio (o li prende dal
// link invito) e li ricorda in quel browser.
window.AMPCLOUD_CONFIG = {
  appName: 'AmpCloud',
  supabaseUrl: '',
  supabaseAnonKey: '',
};
