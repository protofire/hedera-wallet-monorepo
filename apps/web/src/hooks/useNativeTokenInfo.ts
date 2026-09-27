import { type NativeToken } from '@safe-global/store/gateway/AUTO_GENERATED/transactions'
import { useCurrentChain } from './useChains'
import { ZERO_ADDRESS } from '@safe-global/protocol-kit/dist/src/utils/constants'
import { FEATURES, hasFeature } from '@safe-global/utils/utils/chains'

export const useNativeTokenInfo = (): NativeToken => {
  const chain = useCurrentChain()

  // Hedera's native transfer/balance values (from the gateway's `value` field,
  // and from eth_getBalance) are always reported pre-scaled to the standard
  // 18-decimal "weibar" convention, regardless of HBAR's own correct 8-decimal
  // chain.nativeCurrency.decimals — see WalletBalance for the same override.
  const decimals = chain && hasFeature(chain, FEATURES.HEDERA) ? 18 : (chain?.nativeCurrency.decimals ?? 18)

  return {
    type: 'NATIVE_TOKEN',
    address: ZERO_ADDRESS,
    symbol: chain?.nativeCurrency.symbol ?? 'ETH',
    decimals,
    logoUri: chain?.nativeCurrency.logoUri ?? '',
    name: chain?.nativeCurrency.name ?? 'Ether',
  }
}
