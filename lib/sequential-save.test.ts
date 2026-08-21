import { describe, expect, it } from "vitest";
import { createSequentialSaver } from "@/lib/sequential-save";

/**
 * The two guarantees, and the bug they were written for.
 *
 * Every test here uses a deliberately out-of-order network: the first request
 * is made to take longer than the second. That is the shape that broke the
 * first version of the promotions screen, and a test that resolves its
 * promises in the order they were created would pass against the broken code.
 */

/**
 * Drains the microtask queue.
 *
 * The queue advances through promise callbacks, so "has the next save begun
 * yet?" cannot be answered by awaiting a fixed number of ticks — that couples
 * the test to how many `.then`s the implementation happens to chain. A macrotask
 * boundary runs every pending microtask first, whatever the count.
 */
function flush() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/** A promise with its resolver, so a test can decide when a request lands. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("one save at a time", () => {
  it("does not start a save until the one before it has settled", async () => {
    const saver = createSequentialSaver();
    const first = deferred();
    const order: string[] = [];

    saver.save(async () => {
      order.push("first started");
      await first.promise;
      order.push("first finished");
    });
    saver.save(async () => {
      order.push("second started");
    });

    // The second must not have begun while the first is still in flight.
    await flush();
    expect(order).toEqual(["first started"]);

    first.resolve();
    await saver.settled();

    expect(order).toEqual(["first started", "first finished", "second started"]);
  });

  it("keeps running after one save throws", async () => {
    const saver = createSequentialSaver();
    const order: string[] = [];

    saver.save(async () => {
      throw new Error("the network went away");
    });
    saver.save(async () => {
      order.push("second ran");
    });

    await saver.settled();
    expect(order).toEqual(["second ran"]);
  });

  it("runs every save, in order, however many are queued", async () => {
    const saver = createSequentialSaver();
    const order: number[] = [];

    for (let n = 0; n < 5; n += 1) {
      saver.save(async () => {
        order.push(n);
      });
    }

    await saver.settled();
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("only the newest save writes to the screen", () => {
  /** The reported bug, reproduced: an older reply arriving after a newer one. */
  it("does not let a superseded save overwrite a newer choice", async () => {
    const saver = createSequentialSaver();
    const slow = deferred();
    let onScreen = "nothing";

    saver.save(async (isLatest) => {
      await slow.promise;
      if (isLatest()) {
        onScreen = "Chardonnay";
      }
    });

    // The guest changes their mind before the first request has answered.
    saver.save(async (isLatest) => {
      if (isLatest()) {
        onScreen = "Merlot";
      }
    });

    slow.resolve();
    await saver.settled();

    expect(onScreen).toBe("Merlot");
  });

  it("still performs the superseded save, it just stays quiet", async () => {
    const saver = createSequentialSaver();
    const sent: string[] = [];

    saver.save(async (isLatest) => {
      sent.push("Chardonnay");
      expect(isLatest()).toBe(false);
    });
    saver.save(async (isLatest) => {
      sent.push("Merlot");
      expect(isLatest()).toBe(true);
    });

    await saver.settled();

    // Both requests reach the server; the server's last word is the guest's.
    expect(sent).toEqual(["Chardonnay", "Merlot"]);
  });

  it("lets a lone save speak", async () => {
    const saver = createSequentialSaver();
    let spoke = false;

    saver.save(async (isLatest) => {
      spoke = isLatest();
    });

    await saver.settled();
    expect(spoke).toBe(true);
  });

  /**
   * Superseded *while in flight*, not merely before it started — the case a
   * check taken once at the top of the function would get wrong.
   */
  it("notices it was superseded part-way through", async () => {
    const saver = createSequentialSaver();
    const inFlight = deferred();
    const seen: boolean[] = [];

    saver.save(async (isLatest) => {
      seen.push(isLatest()); // true: nothing has been queued after it yet
      await inFlight.promise;
      seen.push(isLatest()); // false: a newer save was queued while it waited
    });

    // Let the first save actually start before it is superseded; that is what
    // makes this the "in flight" case rather than the "not yet begun" one.
    await flush();
    saver.save(async () => {});
    inFlight.resolve();
    await saver.settled();

    expect(seen).toEqual([true, false]);
  });
});

describe("settled", () => {
  it("resolves immediately when nothing has been queued", async () => {
    await expect(createSequentialSaver().settled()).resolves.toBeUndefined();
  });

  it("resolves even when every save failed", async () => {
    const saver = createSequentialSaver();
    saver.save(async () => {
      throw new Error("no");
    });

    await expect(saver.settled()).resolves.toBeUndefined();
  });
});
