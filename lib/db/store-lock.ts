/**
 * One lock over the whole JSON store.
 *
 * Creating a reservation touches the reservations file, the dates file and —
 * since pass-keys — the keys file too, and those writes must not interleave
 * with another request's read-modify-write cycle. A lock per file would not
 * do: the invariants that matter span files.
 *
 * It lives in its own module so every part of the store shares the same lock
 * rather than each holding a private one, which would silently reintroduce
 * the interleaving this prevents.
 */
let storeLock: Promise<unknown> = Promise.resolve();

export function withStoreLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = storeLock.catch(() => undefined).then(operation);
  storeLock = result.catch(() => undefined);
  return result;
}
