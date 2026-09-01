import path from 'path'
import { createRequire } from 'module'
import type { ResolvedConfig } from '../config/types'

const HANDLE_LEAK_CHECK_MODULE = '@tetherto/pear-wrk-wdk/diagnostics/handle-leak-check'

/**
 * The installed @tetherto/pear-wrk-wdk might predate this subpath entirely
 * (it doesn't exist on /worklet, and older versions don't have it at all).
 * Resolving it for real - rather than guessing from a version number -
 * naturally respects whatever exports map the installed version actually
 * has, so this stays correct without us tracking a minimum version anywhere.
 */
function canRequireHandleLeakCheck (projectRoot: string): boolean {
  try {
    const requireFromProject = createRequire(path.join(projectRoot, 'package.json'))
    requireFromProject.resolve(HANDLE_LEAK_CHECK_MODULE)
    return true
  } catch {
    return false
  }
}

/**
 * Diagnostic: warns if the worklet's event loop hasn't gone idle promptly
 * after a suspend, and repeatedly dumps active handles while it's suspended
 * (see pear-wrk-wdk's registerHandleLeakCheck). Opt-in via
 * wdk.config.js's options.handleLeakCheck - omitted entirely (no require
 * emitted) unless set, so bare-pack never pulls bare-walk-handles into a
 * bundle that doesn't ask for it.
 */
export function generateHandleLeakCheckCode (config: ResolvedConfig): string {
  const handleLeakCheck = config.options?.handleLeakCheck
  if (handleLeakCheck === undefined) return ''

  if (!canRequireHandleLeakCheck(config.projectRoot)) {
    console.warn(`⚠️  options.handleLeakCheck is set, but '${HANDLE_LEAK_CHECK_MODULE}' couldn't be resolved (requires a newer @tetherto/pear-wrk-wdk with this export) - skipping the diagnostic.`)
    return ''
  }

  const args = typeof handleLeakCheck === 'number' ? `{ tickIntervalMs: ${handleLeakCheck} }` : ''

  return `
// Diagnostic (options.handleLeakCheck): warns if the worklet's event loop
// hasn't gone idle promptly after a suspend, and repeatedly dumps active
// handles while suspended.
const { registerHandleLeakCheck } = require('${HANDLE_LEAK_CHECK_MODULE}');
registerHandleLeakCheck(${args});
`
}
