import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** True when the module at `url` is the script Node was started with, following symlinked bins. */
export function isMainModule(url: string): boolean {
  const entry = process.argv[1];
  return entry !== undefined && url === pathToFileURL(realpathSync(entry)).href;
}
