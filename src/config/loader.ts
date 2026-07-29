/**
 * Configuration loader
 */

import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import type { WdkBundleConfig, ResolvedConfig } from './types'
import { validateConfig } from './schema'
import { DEFAULT_BUNDLE_PATH, DEFAULT_BUNDLE_PATH_JSONRPC, DEFAULT_TYPES_PATH, DEFAULT_IOS_ADDONS_DIR, DEFAULT_MACOS_ADDONS_DIR, DEFAULT_ANDROID_ADDONS_DIR, DEFAULT_ADDONS_YML_PATH } from '../constants'

const CONFIG_FILES = [
  'wdk.config.js',
  'wdk.config.cjs',
  'wdk.config.mjs'
]

/**
 * Find config file in directory
 */
function findConfigFile (dir: string): string | null {
  for (const filename of CONFIG_FILES) {
    const filepath = path.join(dir, filename)
    if (fs.existsSync(filepath)) {
      return filepath
    }
  }
  return null
}

async function loadConfigFile (filepath: string): Promise<WdkBundleConfig> {
  const ext = path.extname(filepath)

  if (ext === '.json' || filepath.endsWith('.wdkrc')) {
    const content = fs.readFileSync(filepath, 'utf-8')
    try {
      return JSON.parse(content) as WdkBundleConfig
    } catch (error) {
      throw new Error(
        `Invalid JSON in config file ${filepath}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  // For JS/MJS/CJS files, use dynamic import (supports both CommonJS and ESM)
  const loaded = await import(pathToFileURL(filepath).href) as { default?: WdkBundleConfig } & WdkBundleConfig

  // Handle ES module default exports
  return loaded.default ?? loaded
}

/**
 * Whether the bundle gets the post-pack ESM→CJS conversion.
 *
 * Single source of truth shared by the bundler step and the entry
 * generators, so the runtime `.mjs` loader patch emitted into the entry
 * always matches what was actually done to the bundle.
 *
 * Opt-in and independent of transport and platform: enable it whenever any
 * target engine's Bare port can't load ESM (JSC, QuickJS), leave it off for
 * ESM-capable engines (V8).
 */
export function shouldConvertEsmToCjs (config: WdkBundleConfig): boolean {
  return config.options?.convertEsmToCjs ?? false
}

export async function loadConfig (configPath?: string): Promise<ResolvedConfig> {
  const cwd = process.cwd()

  // Find config file
  let filepath: string

  if (configPath) {
    filepath = path.resolve(cwd, configPath)
    if (!fs.existsSync(filepath)) {
      throw new Error(`Config file not found: ${filepath}`)
    }
  } else {
    const found = findConfigFile(cwd)
    if (!found) {
      throw new Error(
        'No wdk.config.js found. Run `npx wdk-worklet-bundler init` to create one.\n' +
          `Searched for: ${CONFIG_FILES.join(', ')}`
      )
    }
    filepath = found
  }

  // Load config
  const config = await loadConfigFile(filepath)

  // Validate config
  validateConfig(config)

  const projectRoot = path.dirname(filepath)

  // Resolve output paths
  const defaultBundlePath = config.transport === 'jsonrpc' ? DEFAULT_BUNDLE_PATH_JSONRPC : DEFAULT_BUNDLE_PATH
  const resolvedOutput = {
    bundle: path.resolve(
      projectRoot,
      config.output?.bundle || defaultBundlePath
    ),
    types: path.resolve(
      projectRoot,
      config.output?.types || DEFAULT_TYPES_PATH
    ),
    addons: {
      ios: path.resolve(projectRoot, config.output?.addons?.ios || DEFAULT_IOS_ADDONS_DIR),
      macos: path.resolve(projectRoot, config.output?.addons?.macos || DEFAULT_MACOS_ADDONS_DIR),
      android: path.resolve(projectRoot, config.output?.addons?.android || DEFAULT_ANDROID_ADDONS_DIR)
    },
    addonsYml: path.resolve(projectRoot, config.output?.addonsYml || DEFAULT_ADDONS_YML_PATH)
  }

  return {
    ...config,
    configPath: filepath,
    projectRoot,
    resolvedOutput
  }
}

export { validateConfig } from './schema'
