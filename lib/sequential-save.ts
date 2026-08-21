/**
 * Saves that must land in the order they were made.
 *
 * ## The bug this exists for
 *
 * The confirmation screen saves a promotion the moment it is tapped. The first
 * version fired a request per tap and applied whichever response arrived, and
 * two taps in quick succession — which is exactly what changing your mind
 * looks like — raced. When the older response arrived second it wrote the
 * older choice back over the newer one: the screen showed the wine, and the
 * booking held nothing. It was reported as "selecting an option does not save
 * it", which is precisely what it looked like from the outside.
 *
 * ## The two guarantees
 *
 * - **One at a time.** A queued save starts only once every save queued before
 *   it has settled, so the server applies them in the order the guest made
 *   them. Nothing weaker gives that: `Promise.all`, a debounce and a plain
 *   counter all still let two requests be in flight at once, and the network
 *   is free to deliver them either way round.
 * - **Only the newest may speak.** Each save is handed an `isLatest()`. A save
 *   that has been superseded still finishes — its write is the one the guest
 *   asked for at the time, and abandoning it mid-flight would leave the server
 *   holding a state nobody chose — but it must not touch the screen, because
 *   a newer choice is already on its way there.
 *
 * It is a plain module rather than a hook so it can be tested without a DOM,
 * which is the only reason the guarantee above is provable at all.
 */

export type SequentialSaver = {
  /**
   * Queues one save.
   *
   * `run` is called with a predicate that answers "am I still the newest save
   * queued?". Check it after every await, before writing anything a person can
   * see. Errors thrown by `run` are swallowed here so one failure cannot stall
   * the queue — handle them inside `run`, where there is enough context to say
   * something useful.
   */
  save: (run: (isLatest: () => boolean) => Promise<void>) => void;
  /** Resolves when everything queued so far has settled. Tests, mostly. */
  settled: () => Promise<void>;
};

export function createSequentialSaver(): SequentialSaver {
  let queued = 0;
  let chain: Promise<unknown> = Promise.resolve();

  return {
    save(run) {
      const mine = (queued += 1);
      const isLatest = () => mine === queued;

      // The trailing catch is what keeps `chain` permanently resolved, so a
      // save that throws cannot stall every save queued behind it.
      chain = chain.then(() => run(isLatest)).catch(() => undefined);
    },

    settled() {
      return chain.then(
        () => undefined,
        () => undefined,
      );
    },
  };
}
