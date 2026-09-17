#!/usr/bin/env node
/**
 * The `heron` entry point.
 *
 * It exists to be tiny: Node's compile cache has to be switched on before the
 * modules it should cache are loaded, and a static import is loaded before any
 * statement runs. Turning the cache on here and then importing the commands
 * dynamically is what lets every later invocation skip re-stripping the
 * library's types, which was most of a short command's wall time.
 */
import { enableCompileCache } from 'node:module';

try {
  enableCompileCache();
} catch {
  // An unwritable cache directory only costs the speed-up.
}

const { main } = await import('./commands.ts');

main().catch((err: Error) => {
  const message = process.env.HERON_TRACE ? err.stack : err.message;
  console.error(process.argv.includes('--json')
    ? JSON.stringify({ ok: false, error: message }, null, 2)
    : message);
  process.exitCode = 1;
});
