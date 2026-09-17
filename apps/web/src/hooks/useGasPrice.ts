import { useCallback, useMemo } from 'react'
import { type AsyncResult } from '@safe-global/utils/hooks/useAsync'
import { useCurrentChain } from './useChains'
import { useWeb3ReadOnly } from './wallets/web3'
import { useDefaultGasPrice, type GasFeeParams } from '@safe-global/utils/hooks/useDefaultGasPrice'
import useChainId from './useChainId'
import { isHederaChain } from '@/utils/hedera-chains'

// Hashio (Hedera's EVM JSON-RPC relay) always quotes gas price in the standard 18-decimal
// "weibar" convention, but Hedera's native currency (HBAR) is displayed with 8 decimals
// (chain.nativeCurrency.decimals). The shared downstream formatting pipeline
// (getTotalFee/formatVisualAmount in useDefaultGasPrice.ts, GasParams, ReviewStep, etc.)
// always divides by `10 ** chain.nativeCurrency.decimals`, so a real 18-decimal gas price
// would be displayed ~10^10 too large. Rescale here instead of touching that generic,
// chain-agnostic pipeline.
const HEDERA_GAS_PRICE_SCALE = 10n ** 10n

const useGasPrice = (isSpeedUp: boolean = false): AsyncResult<GasFeeParams> => {
  const chain = useCurrentChain()
  const provider = useWeb3ReadOnly()
  const chainId = useChainId()

  const logError = useCallback((e: string) => {
    console.error(e)
  }, [])

  const [gasPrice, gasPriceError, gasPriceLoading] = useDefaultGasPrice(chain, provider, {
    isSpeedUp,
    withPooling: true,
    logError,
  })

  // Hedera: rescale the real, working gas price fetched above so the unmodified downstream
  // getTotalFee/formatVisualAmount(chain.nativeCurrency.decimals) pipeline shows correct HBAR.
  const hederaGasPrice = useMemo<GasFeeParams | undefined>(() => {
    if (!isHederaChain(chainId) || !gasPrice) return undefined
    return {
      maxFeePerGas:
        gasPrice.maxFeePerGas != null ? gasPrice.maxFeePerGas / HEDERA_GAS_PRICE_SCALE : gasPrice.maxFeePerGas,
      maxPriorityFeePerGas:
        gasPrice.maxPriorityFeePerGas != null
          ? gasPrice.maxPriorityFeePerGas / HEDERA_GAS_PRICE_SCALE
          : gasPrice.maxPriorityFeePerGas,
    }
  }, [chainId, gasPrice])

  if (isHederaChain(chainId)) {
    return [hederaGasPrice, gasPriceError, gasPriceLoading]
  }

  return [gasPrice, gasPriceError, gasPriceLoading]
}

export default useGasPrice
