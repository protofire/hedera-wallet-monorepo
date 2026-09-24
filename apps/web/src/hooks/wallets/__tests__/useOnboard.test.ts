import { faker } from '@faker-js/faker'
import type { EIP1193Provider, OnboardAPI, WalletState } from '@web3-onboard/core'
import type { Chain } from '@safe-global/store/gateway/AUTO_GENERATED/chains'
import { getConnectedWallet, switchWallet, trackWalletType, connectLastWallet } from '../useOnboard'
import { trackEvent } from '@/services/analytics'
import { chainBuilder } from '@/tests/builders/chains'
import { FEATURES } from '@safe-global/utils/utils/chains'
import { localItem } from '@/services/local-storage/local'

// mock wallets
jest.mock('@/hooks/wallets/wallets', () => ({
  getDefaultWallets: jest.fn(() => []),
}))

// isWalletUnlocked probes window.ethereum._metamask, which doesn't exist in jsdom — mock it so
// connectLastWallet's own eligibility gate (not wallet-unlock state) is what's under test.
jest.mock('@/utils/wallets', () => ({
  ...jest.requireActual('@/utils/wallets'),
  isWalletUnlocked: jest.fn().mockResolvedValue(true),
}))

// mock analytics - using jest.requireActual to avoid hoisting issues
jest.mock('@/services/analytics', () => ({
  ...(
    jest.requireActual('@safe-global/test/mocks/analytics') as { createAnalyticsMock: () => object }
  ).createAnalyticsMock(),
  WALLET_EVENTS: {
    CONNECT: { action: 'connect_wallet' },
    WALLET_CONNECT: { action: 'wallet_connect' },
  },
  MixpanelEventParams: {
    EOA_WALLET_LABEL: 'EOA Wallet Label',
    EOA_WALLET_ADDRESS: 'EOA Wallet Address',
    EOA_WALLET_NETWORK: 'EOA Wallet Network',
  },
}))

describe('useOnboard', () => {
  describe('getConnectedWallet', () => {
    it('returns the connected wallet', () => {
      const wallets = [
        {
          label: 'Wallet 1',
          icon: 'wallet1.svg',
          provider: null as unknown as EIP1193Provider,
          chains: [{ id: '0x4', namespace: 'evm' }],
          accounts: [
            {
              address: '0x1234567890123456789012345678901234567890',
              ens: {
                name: 'test.eth',
              },
              uns: null,
              balance: {
                ETH: '0.002346456767547',
              },
            },
          ],
        },
        {
          label: 'Wallet 2',
          icon: 'wallet2.svg',
          provider: null as unknown as EIP1193Provider,
          chains: [{ id: '0x100', namespace: 'evm' }],
          accounts: [
            {
              address: '0x2',
              ens: null,
              uns: null,
              balance: null,
            },
          ],
        },
      ] as unknown as WalletState[]

      expect(getConnectedWallet(wallets)).toEqual({
        label: 'Wallet 1',
        icon: 'wallet1.svg',
        address: '0x1234567890123456789012345678901234567890',
        provider: wallets[0].provider,
        chainId: '4',
        ens: 'test.eth',
        balance: '0.00235 ETH',
        isProposer: false,
      })
    })

    it('should not rescale the balance for Hedera chains (eth_getBalance is already 18-decimal-scaled via the Hashio JSON-RPC relay)', () => {
      const wallets = [
        {
          label: 'HashPack',
          icon: 'hashpack.svg',
          provider: null as unknown as EIP1193Provider,
          chains: [{ id: '0x128', namespace: 'evm' }], // 296 = Hedera testnet
          accounts: [
            {
              address: '0xd89cfd973d251ff04d345a4962afb5efa6382036',
              ens: null,
              uns: null,
              balance: {
                HBAR: '14.38886184',
              },
            },
          ],
        },
      ] as unknown as WalletState[]

      expect(getConnectedWallet(wallets)?.balance).toBe('14.38886 HBAR')
    })

    it('should return null if the address is invalid', () => {
      const wallets = [
        {
          label: 'Wallet 1',
          icon: 'wallet1.svg',
          provider: null as unknown as EIP1193Provider,
          chains: [{ id: '0x4', namespace: 'evm' }],
          accounts: [
            {
              address: '0xinvalid',
              ens: null,
              uns: null,
              balance: null,
            },
          ],
        },
      ] as unknown as WalletState[]

      expect(getConnectedWallet(wallets)).toBeNull()
    })
  })

  describe('switchWallet', () => {
    it('should not disconnect the wallet if new wallet connects', async () => {
      const mockNewState = [
        {
          accounts: [
            {
              address: faker.finance.ethereumAddress(),
              ens: undefined,
            },
          ],
          chains: [
            {
              id: '5',
            },
          ],
          label: 'MetaMask',
        },
      ]

      const mockOnboard = {
        state: {
          get: jest.fn().mockReturnValue({
            wallets: [
              {
                accounts: [
                  {
                    address: faker.finance.ethereumAddress(),
                    ens: undefined,
                  },
                ],
                chains: [
                  {
                    id: '5',
                  },
                ],
                label: 'Wallet Connect',
              },
            ],
          }),
        },
        connectWallet: jest.fn().mockResolvedValue(mockNewState),
        disconnectWallet: jest.fn(),
      }

      await switchWallet(mockOnboard as unknown as OnboardAPI)

      expect(mockOnboard.connectWallet).toBeCalled()
      expect(mockOnboard.disconnectWallet).not.toHaveBeenCalled()
    })
  })

  describe('trackWalletType', () => {
    beforeEach(() => {
      ;(trackEvent as jest.Mock).mockClear()
    })

    it('should track wallet connection with proper Mixpanel parameters', () => {
      const wallet = {
        label: 'MetaMask',
        chainId: '1',
        address: '0x1234567890123456789012345678901234567890',
        provider: {} as any,
      }

      const configs = [
        {
          chainId: '1',
          chainName: 'Ethereum',
        },
      ] as Chain[]

      trackWalletType(wallet, configs)

      expect(trackEvent).toHaveBeenCalledWith(
        { action: 'connect_wallet', label: 'MetaMask' },
        {
          'EOA Wallet Label': 'MetaMask',
          'EOA Wallet Address': '0x1234567890123456789012345678901234567890',
          'EOA Wallet Network': 'Ethereum',
        },
      )
    })

    it('should use fallback network name when chain not found', () => {
      const wallet = {
        label: 'MetaMask',
        chainId: '999',
        address: '0x1234567890123456789012345678901234567890',
        provider: {} as any,
      }

      const configs = [
        {
          chainId: '1',
          chainName: 'Ethereum',
        },
      ] as Chain[]

      trackWalletType(wallet, configs)

      expect(trackEvent).toHaveBeenCalledWith(
        { action: 'connect_wallet', label: 'MetaMask' },
        {
          'EOA Wallet Label': 'MetaMask',
          'EOA Wallet Address': '0x1234567890123456789012345678901234567890',
          'EOA Wallet Network': 'Chain 999',
        },
      )
    })

    it('should track additional WalletConnect event for WC wallets', () => {
      const wallet = {
        label: 'WalletConnect',
        chainId: '1',
        address: '0x1234567890123456789012345678901234567890',
        provider: {
          connector: {
            session: {
              peer: {
                metadata: {
                  name: 'Trust Wallet',
                },
              },
            },
          },
        } as any,
      }

      const configs = [
        {
          chainId: '1',
          chainName: 'Ethereum',
        },
      ] as Chain[]

      trackWalletType(wallet, configs)

      expect(trackEvent).toHaveBeenCalledTimes(2)
      expect(trackEvent).toHaveBeenNthCalledWith(2, {
        action: 'wallet_connect',
        label: 'Trust Wallet',
      })
    })
  })

  describe('connectLastWallet', () => {
    const lastWalletStorage = localItem<string>('lastWallet')
    const hederaChain = chainBuilder()
      .with({ chainId: '295', features: [FEATURES.HEDERA] })
      .build()
    const mainnetChain = chainBuilder().with({ chainId: '1', features: [] }).build()

    const mockOnboard = () => ({ connectWallet: jest.fn().mockResolvedValue([]) }) as unknown as OnboardAPI

    afterEach(() => {
      lastWalletStorage.remove()
    })

    it('should reconnect HashPack on a Hedera chain', async () => {
      lastWalletStorage.set('HashPack')
      const onboard = mockOnboard()

      await connectLastWallet(onboard, hederaChain)

      expect(onboard.connectWallet).toHaveBeenCalled()
    })

    it('should reconnect an injected wallet (e.g. MetaMask) on a Hedera chain', async () => {
      lastWalletStorage.set('MetaMask')
      const onboard = mockOnboard()

      await connectLastWallet(onboard, hederaChain)

      expect(onboard.connectWallet).toHaveBeenCalled()
    })

    it('should not reconnect a Hedera-only-excluded wallet (e.g. Ledger) on a Hedera chain', async () => {
      lastWalletStorage.set('Ledger')
      const onboard = mockOnboard()

      await connectLastWallet(onboard, hederaChain)

      expect(onboard.connectWallet).not.toHaveBeenCalled()
    })

    it('should not reconnect a stale HashPack session on a non-Hedera chain', async () => {
      lastWalletStorage.set('HashPack')
      const onboard = mockOnboard()

      await connectLastWallet(onboard, mainnetChain)

      expect(onboard.connectWallet).not.toHaveBeenCalled()
    })

    it('should reconnect MetaMask on a non-Hedera chain', async () => {
      lastWalletStorage.set('MetaMask')
      const onboard = mockOnboard()

      await connectLastWallet(onboard, mainnetChain)

      expect(onboard.connectWallet).toHaveBeenCalled()
    })
  })
})
