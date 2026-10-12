import type { SafeFetchOptions, SafeResponse } from "../security/safe-fetch";

/** Abstraction over network access so the pipeline can run against fixtures in tests. */
export interface Fetcher {
  fetch(url: string, opts?: SafeFetchOptions): Promise<SafeResponse>;
}
