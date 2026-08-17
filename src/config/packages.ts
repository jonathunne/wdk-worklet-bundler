/**
 * Derive the full list of packages a config depends on
 */

import type { WdkBundleConfig } from './types'

export function getPackageList (config: WdkBundleConfig): string[] {
  const packages = new Set<string>()

  // Add core (always required implicitly, unless overriden/preloaded logic changes)
  // For validation, we should probably check it.
  packages.add('@tetherto/wdk')
  packages.add('bare-node-runtime')
  // Both transport entries require the Pear Worklet runtime unconditionally
  // (hrpc → @tetherto/pear-wrk-wdk/worklet, jsonrpc → @tetherto/pear-wrk-wdk/jsonrpc)
  packages.add('@tetherto/pear-wrk-wdk')

  if (config.networks) {
    for (const net of Object.values(config.networks)) {
      if (net.package) packages.add(net.package)
    }
  }

  if (config.protocols != null) {
    for (const protocol of Object.values(config.protocols)) {
      if (protocol?.package) packages.add(protocol.package)
    }
  }

  if (config.modules != null) {
    for (const mod of Object.values(config.modules)) {
      if (mod && mod.package) packages.add(mod.package)
    }
  }

  if (config.preloadModules != null) {
    for (const mod of config.preloadModules) {
      packages.add(mod)
    }
  }

  return Array.from(packages)
}
