import { request } from "./client.mjs";

// Created-resource registry. Tests call track() with the DELETE path for
// anything they create so cleanup() can tear it down even if an assertion
// fails mid-test. Wire cleanup() into afterEach/afterAll.

const tracked = [];

// Namespace test data so a shared staging table never collides with real
// rows and stray records are obvious. e.g. ns("animal") -> "itest-animal-8f3k2a".
export function ns(prefix = "itest") {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `itest-${prefix}-${suffix}`;
}

// Register a resource for teardown. Pass the path the API deletes it at
// (e.g. `/animals/${id}`); cleanup() will DELETE it.
export function track(deletePath) {
  tracked.push(deletePath);
  return deletePath;
}

// DELETE every tracked resource, newest first, swallowing individual
// failures so one stuck resource can't block the rest of teardown.
export async function cleanup() {
  while (tracked.length > 0) {
    const path = tracked.pop();
    try {
      await request("DELETE", path);
    } catch (err) {
      // Best-effort teardown -- log and continue.
      console.warn(`cleanup: failed to delete ${path}: ${err?.message}`);
    }
  }
}
