import type { Category } from "./types";

/** Categories compared in competitor snapshots. Performance and mobile need extra runs, so they are not compared. */
export const SNAPSHOT_CATEGORIES: Category[] = ["technical", "onpage", "content", "images", "aeo", "geo", "accessibility", "security"];
