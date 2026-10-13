// Dependency-light on purpose: imported by the firebase-messaging service worker too
import type { Chain } from '@safe-global/store/gateway/AUTO_GENERATED/chains'
import { FEATURES, hasFeature } from '@safe-global/utils/utils/chains'

/**
 * Hedera's JSON-RPC relay (Hashio) reports native HBAR amounts pre-scaled to the 18-decimal
 * "weibar" convention, not HBAR's real 8-decimal (tinybar) `nativeCurrency.decimals`.
 */
export const HEDERA_RPC_NATIVE_DECIMALS = 18

/**
 * Decimals of a native-currency amount that was read through the chain's JSON-RPC relay
 * (`eth_getBalance`, indexed incoming transfers, INCOMING_ETHER webhooks).
 */
export const getRpcNativeCurrencyDecimals = (
  chain: Pick<Chain, 'features' | 'nativeCurrency'> | undefined,
): number | undefined => {
  if (!chain) return undefined
  return hasFeature(chain, FEATURES.HEDERA) ? HEDERA_RPC_NATIVE_DECIMALS : chain.nativeCurrency.decimals
}
