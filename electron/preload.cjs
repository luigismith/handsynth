// HandSynth — Electron preload script.
//
// Intentionally minimal. The renderer is the same web app that runs in a
// regular browser; it has no IPC needs at this point (no native file pickers,
// no auto-update wiring, no shell-out). Keeping this empty preserves the
// strict context-isolation contract — nothing extra leaks into `window`.
//
// If/when we need to expose something (e.g., open-external for help links,
// or a "save preset" file dialog), do it here via:
//
//   const { contextBridge, ipcRenderer } = require('electron');
//   contextBridge.exposeInMainWorld('handsynth', { ... });
//
// For now: no-op.
