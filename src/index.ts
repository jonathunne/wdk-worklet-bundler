/**
 * @tetherto/wdk-worklet-bundler
 *
 * CLI tool for generating WDK worklet bundles from configuration.
 */

// Config
export { loadConfig } from './config/loader'
export type { WdkBundleConfig, ResolvedConfig } from './config/types'

// Validators
export { validateDependencies, installDependencies, uninstallDependencies, detectPackageManager, generateInstallCommand, generateUninstallCommand } from './validators/dependencies'
export type { ModuleInfo, ValidationResult, InstallResult, UninstallResult } from './validators/dependencies'

// Bundler
export { generateBundle, generateSourceFiles, linkAddons } from './bundler'
export type { GenerateBundleOptions, GenerateBundleResult, LinkAddonsOptions, LinkAddonsResult } from './bundler'
export { convertBundleEsmToCjs, validateBundle } from './bundler/convert-esm-to-cjs' // Added here for a potential cli so we can check arifacts for the cli here and maybe to wdk-cli validate-bundle etc... 

// Generators
export { generateEntryPoint } from './generators/entry'
export { generateJsonRpcEntryPoint } from './generators/entry-jsonrpc'
export { generateAddonsYml } from './generators/addons-yml'
export { generateWalletModulesCode } from './generators/wallet-modules'
