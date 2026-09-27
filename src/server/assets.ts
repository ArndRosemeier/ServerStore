/**
 * The admin UI's assets — THREE literal routes, and deliberately nothing more.
 *
 * There is NO static-file subsystem here: {@link UI_ASSETS} is the complete table of
 * what the service serves, each entry names its file LITERALLY, and no client-supplied
 * string ever reaches a path. A directory-walking static handler would add path
 * traversal, index resolution and a content-type guesser to a service whose whole point
 * is that it is small; this seam is the alternative (ledger row 49).
 *
 * The files live in `web/` at the checkout root and are resolved from THIS module, so
 * the path does not depend on the process's working directory. A missing file is a LOUD
 * 500 (`readUiAsset`): the console must never be served as a blank page.
 */

import { readFile } from "node:fs/promises";
import { StoreError } from "../core/errors.ts";

export interface UiAsset {
  /** The literal route the service serves it on. Never a pattern. */
  readonly route: string;
  /** The file under `web/`, named literally. Never a path a client supplies. */
  readonly file: string;
  readonly contentType: string;
}

/** The THREE routes, in one place — the tests read this table rather than a copy. */
export const UI_ASSETS: readonly UiAsset[] = [
  { route: "/", file: "index.html", contentType: "text/html; charset=utf-8" },
  { route: "/app.js", file: "app.js", contentType: "text/javascript; charset=utf-8" },
  { route: "/app.css", file: "app.css", contentType: "text/css; charset=utf-8" },
];

/** `web/` beside the checkout root, resolved from this module — never from cwd. */
const WEB_ROOT = new URL("../../web/", import.meta.url);

export async function readUiAsset(asset: UiAsset): Promise<string> {
  try {
    return await readFile(new URL(asset.file, WEB_ROOT), "utf8");
  } catch (error) {
    throw new StoreError(
      "internal",
      `the admin UI asset web/${asset.file} could not be read: ${(error as Error).message}`,
    );
  }
}
