/**
 * Configuration types for wdk-worklet-bundler
 */

export interface WdkBundleConfig {
  /** Module definitions: key -> package path */
  networks: {
    [networkName: string]: {
      package: string
    }
  }

  /** Protocol definitions: key -> package path */
  protocols?: {
    [protocolName: string]: {
      package: string
      [key: string]: unknown
    }
  }

  /**
   * Generic module definitions: key -> package + optional factory/events. The
   * package exports createModule({ seed, config, capabilities, emit }) -> instance;
   * a module needing storage builds it from config (e.g. config.storagePath).
   */
  modules?: {
    [moduleName: string]: {
      /** Module package name (the factory exporting createModule(ctx)) */
      package: string
      /** Named factory export to call (default: the package's default export) */
      factory?: string
      /** Events forwarded host-ward as moduleEvent (e.g. ['update']) */
      events?: string[]
    }
  }

  /** Modules to preload (native addons like spark-frost-bare-addon) */
  preloadModules?: string[]

  /** Transport mechanism for worklet communication */
  transport?: 'hrpc' | 'jsonrpc'

  /** Output paths */
  output?: {
    bundle?: string
    types?: string
    /** Output directories for bare-link native addons, per platform */
    addons?: {
      ios?: string
      macos?: string
      android?: string
    }
    /** Path for the generated addons.yml (BareKit Swift dependency list) */
    addonsYml?: string
  }

  /** Build options */
  options?: {
    minify?: boolean
    sourceMaps?: boolean
    targets?: string[]
    /** Link native addons via bare-link. Defaults to true when transport is 'jsonrpc'. */
    linkAddons?: boolean
    /** Platforms to generate addons for. Defaults to all three when linkAddons is active. */
    platforms?: Array<'ios' | 'macos' | 'android'>
    /** Xcode target name used in the generated addons.yml. Defaults to 'app'. */
    swiftTarget?: string
    /** Convert ESM to CJS in the bundle. Required for engines whose Bare port
     *  can't load ES modules (e.g. JSC on iOS/macOS, QuickJS on Android);
     *  leave off when every target runs an ESM-capable engine (V8).
     *  Also controls the runtime .mjs-as-CJS loader patch in the generated entry.
     * Defaults to false. */
    convertEsmToCjs?: boolean
  }
}

export interface ResolvedConfig extends WdkBundleConfig {
  /** Absolute path to config file */
  configPath: string
  /** Absolute path to project root */
  projectRoot: string
  /** Resolved output paths (absolute) */
  resolvedOutput: {
    bundle: string
    types: string
    addons: {
      ios: string
      macos: string
      android: string
    }
    addonsYml: string
  }
}
