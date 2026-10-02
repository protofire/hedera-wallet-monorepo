import { type NativeToken } from '@safe-global/store/gateway/AUTO_GENERATED/transactions'
import { useCurrentChain } from './useChains'
import { ZERO_ADDRESS } from '@safe-global/protocol-kit/dist/src/utils/constants'

export const useNativeTokenInfo = (): NativeToken => {
  const chain = useCurrentChain()

  // This only ever decodes the Safe's *own* transaction data (e.g. a MultiSend action's decoded
  // view) — an outgoing value we ourselves submitted using the native currency's real precision
  // (8-decimal tinybar for HBAR), never Hashio's 18-decimal "weibar" RPC wire-format. Unlike
  // WalletBalance/useDefaultGasPrice (which read live eth_getBalance/eth_gasPrice), there's no
  // Hedera override to apply here.
  const decimals = chain?.nativeCurrency.decimals ?? 18

  return {
    type: 'NATIVE_TOKEN',
    address: ZERO_ADDRESS,
    symbol: chain?.nativeCurrency.symbol ?? 'ETH',
    decimals,
    logoUri: chain?.nativeCurrency.logoUri ?? '',
    name: chain?.nativeCurrency.name ?? 'Ether',
  }
}
