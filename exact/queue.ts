// Observations waiting to upload, kept on the device so they survive going
// offline and the app being closed. Each is a create request without its
// images, plus the JPEGs (already shrunk to the server's limit) beside it.
//
//   app:/data/queue.json        the items, oldest first
//   app:/data/queue/<id>-<n>.jpg their photos
import type { Storage } from './app.contract.d.ts';
import type { CreateOccurrenceRequest } from './bindings/CreateOccurrenceRequest.ts';

// Needs app.ts's grants 'fs.read app:/data' and 'fs.write app:/data'.
const FILE = 'app:/data/queue.json';
const DIR = 'app:/data/queue';

export type Queued = {
  id: string;
  title: string;
  thumb: string;
  // waiting: it will be sent; failed: the appview refused it, and the person decides.
  status: 'waiting' | 'failed';
  error: string;
  attempts: number;
  body: Omit<CreateOccurrenceRequest, 'images'>;
  photos: string[];
};

export type Sent = { sent: number; failed: number; waiting: number; offline: boolean; error: string };

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export async function readQueue(storage: Storage): Promise<Queued[]> {
  try {
    return JSON.parse(decoder.decode(await storage.fs.readFile(FILE))) as Queued[];
  } catch (e) {
    if ((e as { code?: string }).code === 'ENOENT') return [];
    throw e;
  }
}

async function writeQueue(storage: Storage, items: Queued[]) {
  await storage.fs.atomicWriteFile(FILE, encoder.encode(JSON.stringify(items)));
}

let dirMade: Promise<void> | null = null;
const ensureDir = (storage: Storage) =>
  (dirMade ??= (async () => {
    for (const d of ['app:/data', DIR]) {
      await storage.fs.mkdir(d).catch((e: { code?: string }) => {
        if (e.code !== 'EEXIST') throw e;
      });
    }
  })().catch((e) => {
    dirMade = null;
    throw e;
  }));

// One change to the queue at a time: adding, sending and discarding each read
// it, change it and write it back.
let turn: Promise<unknown> = Promise.resolve();
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const next = turn.then(work, work);
  turn = next.catch(() => undefined);
  return next;
}

/** Add observations to the queue: each one's photos as JPEG bytes. */
export function enqueue(
  storage: Storage,
  drafts: { title: string; thumb: string; body: Queued['body']; jpegs: Uint8Array[] }[],
): Promise<number> {
  return inTurn(async () => {
    await ensureDir(storage);
    const items = await readQueue(storage);
    for (const d of drafts) {
      const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
      const photos: string[] = [];
      for (const [n, bytes] of d.jpegs.entries()) {
        const path = `${DIR}/${id}-${n}.jpg`;
        await storage.fs.atomicWriteFile(path, bytes);
        photos.push(path);
      }
      items.push({ id, title: d.title, thumb: d.thumb, status: 'waiting', error: '', attempts: 0, body: d.body, photos });
    }
    await writeQueue(storage, items);
    return drafts.length;
  });
}

async function forget(storage: Storage, item: Queued) {
  for (const p of item.photos) await storage.fs.rm(p).catch(() => undefined);
}

/**
 * Send what's waiting, oldest first. Stops at the first sign of being offline
 * (or a lapsed session) and leaves the rest waiting; a refusal marks that item
 * failed and goes on to the next.
 */
export function sendWaiting(
  storage: Storage,
  post: (body: CreateOccurrenceRequest) => Promise<Response>,
  toBase64: (bytes: Uint8Array) => string,
): Promise<Sent> {
  return inTurn(async () => {
    const items = await readQueue(storage);
    const result: Sent = { sent: 0, failed: 0, waiting: 0, offline: false, error: '' };
    const kept: Queued[] = [];
    let stopped = false;
    for (const item of items) {
      if (stopped || item.status !== 'waiting') {
        kept.push(item);
        continue;
      }
      let response: Response;
      try {
        const images = [];
        for (const p of item.photos) images.push({ data: toBase64(new Uint8Array(await storage.fs.readFile(p))), mimeType: 'image/jpeg' });
        response = await post({ ...item.body, images });
      } catch {
        kept.push({ ...item, attempts: item.attempts + 1 });
        result.offline = true;
        stopped = true;
        continue;
      }
      if (response.ok) {
        await forget(storage, item);
        result.sent += 1;
      } else if (response.status === 401) {
        kept.push(item);
        result.error = 'Your session ended. Sign in again to upload.';
        stopped = true;
      } else if (response.status >= 500 || response.status === 408 || response.status === 429) {
        // The appview's trouble, not the observation's: try again later.
        kept.push({ ...item, attempts: item.attempts + 1 });
      } else {
        const message = await response.json().then((b: { error?: string }) => b.error ?? '', () => '');
        kept.push({ ...item, status: 'failed', error: message || `Refused (${response.status}).`, attempts: item.attempts + 1 });
      }
    }
    await writeQueue(storage, kept);
    result.waiting = kept.filter((i) => i.status === 'waiting').length;
    result.failed = kept.filter((i) => i.status === 'failed').length;
    return result;
  });
}

/** Put a failed item back in line. */
export function retry(storage: Storage, id: string): Promise<void> {
  return inTurn(async () => {
    const items = await readQueue(storage);
    await writeQueue(storage, items.map((i) => (i.id === id ? { ...i, status: 'waiting', error: '' } : i)));
  });
}

/** Drop an item and its photos. */
export function discard(storage: Storage, id: string): Promise<void> {
  return inTurn(async () => {
    const items = await readQueue(storage);
    const gone = items.find((i) => i.id === id);
    if (gone) await forget(storage, gone);
    await writeQueue(storage, items.filter((i) => i.id !== id));
  });
}
