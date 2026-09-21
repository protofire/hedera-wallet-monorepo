import { WC_PROJECT_ID } from '@/config/constants'
import type { Chain } from '@safe-global/store/gateway/AUTO_GENERATED/chains'
import type { InitOptions } from '@web3-onboard/core'
import coinbaseModule from '@web3-onboard/coinbase'
import injectedWalletModule from '@web3-onboard/injected-wallets'
import walletConnect from '@web3-onboard/walletconnect'
import pkModule from '@/services/private-key-module'
import { ledgerModule } from '@/services/onboard/ledger-module'
import hashpackModule from '@/services/onboard/hashpack-module'
import { FEATURES, hasFeature } from '@safe-global/utils/utils/chains'

import { CGW_NAMES, WALLET_KEYS } from './consts'

const prefersDarkMode = (): boolean => {
  return window?.matchMedia('(prefers-color-scheme: dark)')?.matches
}

type WalletInits = InitOptions['wallets']
type WalletInit = WalletInits extends Array<infer U> ? U : never

const walletConnectV2 = (chain: Chain) => {
  // WalletConnect v2 requires a project ID
  if (!WC_PROJECT_ID) {
    return () => null
  }

  return walletConnect({
    version: 2,
    projectId: WC_PROJECT_ID,
    qrModalOptions: {
      themeVariables: {
        '--wcm-z-index': '1302',
      },
      themeMode: prefersDarkMode() ? 'dark' : 'light',
    },
    requiredChains: [parseInt(chain.chainId)],
    dappUrl: location.origin,
  })
}

const WALLET_MODULES: Partial<{ [_key in WALLET_KEYS]: (chain: Chain) => WalletInit }> = {
  [WALLET_KEYS.INJECTED]: () => injectedWalletModule() as WalletInit,
  [WALLET_KEYS.WALLETCONNECT_V2]: (chain) => walletConnectV2(chain) as WalletInit,
  [WALLET_KEYS.COINBASE]: () => coinbaseModule({ darkMode: prefersDarkMode() }) as WalletInit,
  [WALLET_KEYS.LEDGER]: () => ledgerModule(),
  [WALLET_KEYS.PK]: (chain) => pkModule(chain.chainId, chain.rpcUri) as WalletInit,
  [WALLET_KEYS.HASHPACK]: (chain) => hashpackModule(chain) as WalletInit,
}

export const getAllWallets = (chain: Chain): WalletInits => {
  return Object.values(WALLET_MODULES).map((module) => module(chain))
}

export const isWalletSupported = (disabledWallets: string[], walletLabel: string): boolean => {
  const legacyWalletName = CGW_NAMES?.[walletLabel.toUpperCase() as WALLET_KEYS]
  return !disabledWallets.includes(legacyWalletName || walletLabel)
}

export const getSupportedWallets = (chain: Chain): WalletInits => {
  // Hedera chains only ever offer HashPack plus a plain injected wallet (MetaMask, ECDSA-only,
  // talking directly to Hashio) — never fall through to the full generic wallet list below.
  // EIP-6963 support is disabled on the injected module specifically because HashPack also
  // announces itself as a plain EIP-6963 injected provider (MetaMask-style EVM emulation),
  // which would otherwise get auto-detected as a second, ECDSA-only "HashPack" entry alongside
  // the real module above. MetaMask still gets picked up via its legacy
  // `window.ethereum.isMetaMask` flag, which injected-wallets checks regardless of EIP-6963.
  if (hasFeature(chain, FEATURES.HEDERA)) {
    const hashpack = WALLET_MODULES[WALLET_KEYS.HASHPACK]?.(chain)
    const injected = injectedWalletModule({ disable6963Support: true }) as WalletInit
    return hashpack ? [hashpack, injected] : [injected]
  }

  const enabledWallets = Object.entries(WALLET_MODULES).filter(([key]) => isWalletSupported(chain.disabledWallets, key))

  if (enabledWallets.length === 0) {
    return [injectedWalletModule()]
  }

  return enabledWallets.map(([, module]) => module(chain))
}
