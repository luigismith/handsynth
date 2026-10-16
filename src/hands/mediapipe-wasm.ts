// Owner: hand-tracker
//
// MediaPipe WASM base URL, shared by HandTracker and FaceTracker.
//
// Pinned to the exact @mediapipe/tasks-vision version that Vite bundles:
// the JS glue in our bundle and the WASM it loads must come from the same
// release, and `@latest` would break tracking for every visitor of the
// published site the day MediaPipe ships an incompatible build.
// mediapipe-wasm.test.ts fails if the installed package moves without
// this constant.

export const MEDIAPIPE_TASKS_VISION_VERSION = '0.10.35';

export const MEDIAPIPE_WASM_BASE =
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_TASKS_VISION_VERSION}/wasm`;
