import type { WdkBundleConfig } from '../config/types'
import { shouldConvertEsmToCjs } from '../config/loader'

/**
 * Runtime counterpart of the build-time ESM→CJS bundle conversion.
 *
 * When convertEsmToCjs is active, every `.mjs` file in the bundle holds CJS
 * code but keeps its extension, so the entry must route `.mjs` through the
 * CJS loader on every platform — engines with native ESM (V8) would otherwise
 * parse the converted files as modules and fail on `require`/`exports`.
 * When conversion is off the patch is omitted entirely.
 */
export function generateMjsAsCjsPatch (config: WdkBundleConfig): string {
  if (!shouldConvertEsmToCjs(config)) return ''

  return `
// Bundle was converted ESM→CJS at build time (options.convertEsmToCjs):
// .mjs files now contain CJS code, so load them through the CJS loader.
module.constructor._extensions['.mjs'] = module.constructor._extensions['.js']
`
}
