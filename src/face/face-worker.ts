// Owner: hand-tracker
//
// Web Worker hosting the MediaPipe FaceLandmarker. Strategy (A) — inference-
// only: this worker owns the model and runs `detectForVideo` on `ImageBitmap`
// frames sent from the main thread, then posts back a lean, transferable
// payload (landmarks as a single Float32Array, blendshapes as a small {name,
// score}[], optional 4x4 matrix). The main thread keeps the One-Euro
// filtering, mirror, FaceState assembly, and edge-event detection — all of
// which are cheap and avoid duplicating filter state across threads.
//
// Why (A) over a fully-isolated worker:
//   - One Euro filtering and mirror flip are O(N) and cost ~0.1 ms; not worth
//     the protocol complexity to push them off-thread.
//   - Landmarks are needed on main for the visualizer's face skeleton render;
//     a "result" message that returns just smoothed scalars would force a
//     second copy of the landmarks down the wire anyway.
//   - Debuggability: synchronous post-processing on main makes it trivial to
//     log/inspect with the regular DevTools.
//
// Wire protocol (main → worker):
//   { type: 'init', wasmBase: string, modelUrl: string, delegate: 'GPU'|'CPU' }
//   { type: 'frame', id: number, bitmap: ImageBitmap, timestamp: number }
//   { type: 'close' }
//
// Wire protocol (worker → main):
//   { type: 'ready' }
//   { type: 'result', id, landmarks: Float32Array (3*N) | null,
//     numLandmarks, blendshapes?: { name; score }[],
//     matrixData?: Float32Array(16) | null, timestamp }
//   { type: 'error', message: string }

import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from '@mediapipe/tasks-vision';

// ---------------------------------------------------------------------------
// Message types (also imported by FaceTracker.ts on the main thread).
// ---------------------------------------------------------------------------

export interface InitMessage {
  type: 'init';
  wasmBase: string;
  modelUrl: string;
  delegate: 'GPU' | 'CPU';
}

export interface FrameMessage {
  type: 'frame';
  id: number;
  bitmap: ImageBitmap;
  timestamp: number;
}

export interface CloseMessage {
  type: 'close';
}

export type WorkerInbound = InitMessage | FrameMessage | CloseMessage;

export interface ReadyMessage {
  type: 'ready';
}

export interface ResultMessage {
  type: 'result';
  /** Echo of the FrameMessage.id so the main thread can drop stale results. */
  id: number;
  /** [x0, y0, z0, x1, y1, z1, ...] — length === numLandmarks * 3. Null if no face. */
  landmarks: Float32Array | null;
  /** Number of landmarks in the array (typically 478). 0 when no face. */
  numLandmarks: number;
  /** Subset of blendshape categories — we only need a few names downstream. */
  blendshapes: { name: string; score: number }[];
  /** 16-element row-major facial transformation matrix, or null. */
  matrixData: Float32Array | null;
  /** Echo of the inbound timestamp (video presentation time, ms). */
  timestamp: number;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export type WorkerOutbound = ReadyMessage | ResultMessage | ErrorMessage;

// ---------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------

let landmarker: FaceLandmarker | null = null;
let initInFlight: Promise<void> | null = null;

const NUM_FACE_LANDMARKS = 478;

// `self` inside a DedicatedWorkerGlobalScope exposes postMessage. The DOM lib
// alone doesn't include the worker-scope type, so we use a structural cast.
interface WorkerScopeLike {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
}

function postOut(msg: WorkerOutbound, transfer?: Transferable[]): void {
  const scope = self as unknown as WorkerScopeLike;
  if (transfer && transfer.length) {
    scope.postMessage(msg, transfer);
  } else {
    scope.postMessage(msg);
  }
}

async function initLandmarker(msg: InitMessage): Promise<void> {
  const vision = await FilesetResolver.forVisionTasks(msg.wasmBase);
  landmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: msg.modelUrl,
      delegate: msg.delegate,
    },
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
    runningMode: 'VIDEO',
    numFaces: 1,
  });
}

function packLandmarks(
  result: FaceLandmarkerResult,
): { landmarks: Float32Array | null; numLandmarks: number } {
  const lms = result.faceLandmarks?.[0];
  if (!lms || lms.length === 0) {
    return { landmarks: null, numLandmarks: 0 };
  }
  const buf = new Float32Array(lms.length * 3);
  for (let i = 0; i < lms.length; i += 1) {
    const p = lms[i]!;
    const o = i * 3;
    buf[o] = p.x;
    buf[o + 1] = p.y;
    buf[o + 2] = p.z;
  }
  return { landmarks: buf, numLandmarks: lms.length };
}

function packBlendshapes(
  result: FaceLandmarkerResult,
): { name: string; score: number }[] {
  const cls = result.faceBlendshapes?.[0];
  if (!cls) return [];
  // We only consume a couple of names downstream (jawOpen, browInnerUp). Send
  // the full list anyway — it's ~52 small entries and the main thread might
  // expand its use later. Strip the index/displayName fields to keep wire
  // small.
  const out: { name: string; score: number }[] = new Array(cls.categories.length);
  for (let i = 0; i < cls.categories.length; i += 1) {
    const cat = cls.categories[i]!;
    out[i] = { name: cat.categoryName, score: cat.score };
  }
  return out;
}

function packMatrix(result: FaceLandmarkerResult): Float32Array | null {
  const m = result.facialTransformationMatrixes?.[0];
  if (!m || !m.data) return null;
  // Row-major 4x4. Some MediaPipe builds give Float32Array, others number[].
  if (m.data instanceof Float32Array) {
    // Copy so we own the buffer (originals are kept by MediaPipe internals).
    return new Float32Array(m.data);
  }
  const f = new Float32Array(16);
  const len = Math.min(16, m.data.length);
  for (let i = 0; i < len; i += 1) f[i] = m.data[i]!;
  return f;
}

function runFrame(msg: FrameMessage): void {
  if (!landmarker) {
    postOut({
      type: 'error',
      message: 'face-worker: frame received before init',
    });
    // Even on error: release the bitmap.
    msg.bitmap.close();
    return;
  }
  let result: FaceLandmarkerResult;
  try {
    result = landmarker.detectForVideo(msg.bitmap, msg.timestamp);
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : 'face-worker: detectForVideo failed';
    postOut({ type: 'error', message });
    msg.bitmap.close();
    return;
  } finally {
    // Always release the ImageBitmap — we own it (it was transferred to us).
    // detectForVideo copies the pixels into MediaPipe's internal buffers, so
    // we don't need to hold the bitmap past the call.
  }
  // Close after the call — see comment above.
  try {
    msg.bitmap.close();
  } catch {
    // Some browsers throw on double-close; ignore.
  }

  const { landmarks, numLandmarks } = packLandmarks(result);
  const blendshapes = packBlendshapes(result);
  const matrixData = packMatrix(result);

  const transfer: Transferable[] = [];
  if (landmarks) transfer.push(landmarks.buffer);
  if (matrixData) transfer.push(matrixData.buffer);

  postOut(
    {
      type: 'result',
      id: msg.id,
      landmarks,
      numLandmarks,
      blendshapes,
      matrixData,
      timestamp: msg.timestamp,
    },
    transfer,
  );
}

// ---------------------------------------------------------------------------
// Message dispatch
// ---------------------------------------------------------------------------

self.addEventListener('message', (ev: MessageEvent<WorkerInbound>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'init': {
      if (initInFlight) {
        // Reject duplicate init attempts.
        initInFlight
          .then(() => postOut({ type: 'ready' }))
          .catch((err: unknown) => {
            const message =
              err instanceof Error
                ? err.message
                : 'face-worker: init failed';
            postOut({ type: 'error', message });
          });
        return;
      }
      initInFlight = initLandmarker(msg);
      initInFlight
        .then(() => postOut({ type: 'ready' }))
        .catch((err: unknown) => {
          const message =
            err instanceof Error ? err.message : 'face-worker: init failed';
          postOut({ type: 'error', message });
        });
      return;
    }
    case 'frame': {
      runFrame(msg);
      return;
    }
    case 'close': {
      try {
        landmarker?.close();
      } catch {
        // Ignore — best-effort teardown.
      }
      landmarker = null;
      // The host will call worker.terminate() right after this.
      return;
    }
    default: {
      // Exhaustiveness — unknown message types are ignored.
      const _unknown: never = msg;
      void _unknown;
    }
  }
});

// Mark NUM_FACE_LANDMARKS as used (export-only sentinel — it documents the
// expected landmark count for downstream consumers that import this file as
// a regular module rather than via `?worker`).
export const FACE_WORKER_NUM_LANDMARKS = NUM_FACE_LANDMARKS;
