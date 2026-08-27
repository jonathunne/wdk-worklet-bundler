import { getPackageList } from '../../src/config/packages'
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
