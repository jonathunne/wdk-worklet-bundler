import { getPackageList, installablePackageRoot } from '../../src/config/packages'
import type { WdkBundleConfig } from '../../src/config/types'

const makeConfig = (overrides: Partial<WdkBundleConfig> = {}): WdkBundleConfig =>
  ({ networks: {}, ...overrides })

describe('getPackageList', () => {
  it('always includes the core packages and the Pear Worklet runtime', () => {
    const packages = getPackageList(makeConfig())

    expect(packages).toContain('@tetherto/wdk')
    expect(packages).toContain('bare-node-runtime')
    // Both transport entries require it unconditionally, so it must be
    // validated/installed upfront instead of surfacing as a bare-pack failure
    expect(packages).toContain('@tetherto/pear-wrk-wdk')
  })

  it('includes the Pear Worklet runtime regardless of transport', () => {
    for (const transport of ['hrpc', 'jsonrpc'] as const) {
      expect(getPackageList(makeConfig({ transport }))).toContain('@tetherto/pear-wrk-wdk')
    }
  })

  it('collects network, protocol, module and preload packages without duplicates', () => {
    const packages = getPackageList(makeConfig({
      networks: {
        bitcoin: { package: '@tetherto/wdk-wallet-btc' },
        ethereum: { package: '@tetherto/wdk-wallet-evm' }
      },
      preloadModules: ['@tetherto/wdk-wallet-btc', 'extra-preload']
    }))

    expect(packages).toContain('@tetherto/wdk-wallet-btc')
    expect(packages).toContain('@tetherto/wdk-wallet-evm')
    expect(packages).toContain('extra-preload')
    expect(packages.filter(p => p === '@tetherto/wdk-wallet-btc')).toHaveLength(1)
  })
})

describe('installablePackageRoot', () => {
  it('strips subpaths from scoped specifiers', () => {
    expect(installablePackageRoot('@tetherto/pear-wrk-wdk/worklet')).toBe('@tetherto/pear-wrk-wdk')
    expect(installablePackageRoot('@tetherto/pear-wrk-wdk/jsonrpc')).toBe('@tetherto/pear-wrk-wdk')
  })

  it('strips subpaths from unscoped specifiers', () => {
    expect(installablePackageRoot('ws/lib/websocket')).toBe('ws')
  })

  it('returns plain package names unchanged', () => {
    expect(installablePackageRoot('bare-node-runtime')).toBe('bare-node-runtime')
    expect(installablePackageRoot('@tetherto/wdk')).toBe('@tetherto/wdk')
  })

  it('returns null for relative and absolute specifiers (nothing installable)', () => {
    expect(installablePackageRoot('./generated/entry.js')).toBeNull()
    expect(installablePackageRoot('../outside.js')).toBeNull()
    expect(installablePackageRoot('/abs/path.js')).toBeNull()
  })

  it('returns null for private imports-field mappings and URL-like specifiers', () => {
    expect(installablePackageRoot('#internal/db')).toBeNull()
    expect(installablePackageRoot('node:fs')).toBeNull()
    expect(installablePackageRoot('file:///abs/path.js')).toBeNull()
  })

  it('returns null for a bare scope (npm cannot install a whole scope)', () => {
    expect(installablePackageRoot('@tetherto')).toBeNull()
  })
})
