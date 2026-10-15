import { rmSync } from 'node:fs';

for (const directory of ['dist', 'build/test', 'build/test-support', 'build/src', 'build/scripts', 'build/typecheck']) {
  rmSync(new URL(`../../${directory}/`, import.meta.url), { recursive: true, force: true });
}
