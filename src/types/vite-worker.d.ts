// Owner: hand-tracker
//
// Module shim for Vite's `?worker` suffix. Vite rewrites these imports at
// build time into a constructor that returns a fresh `Worker` instance for
// each `new` call. The TS compiler doesn't know about `?worker` natively, so
// we declare it here.

declare module '*?worker' {
  const WorkerCtor: new () => Worker;
  export default WorkerCtor;
}

declare module '*?worker&inline' {
  const WorkerCtor: new () => Worker;
  export default WorkerCtor;
}
