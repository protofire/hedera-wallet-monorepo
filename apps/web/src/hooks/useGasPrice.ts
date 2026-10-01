import { useCallback } from 'react'
import { type AsyncResult } from '@safe-global/utils/hooks/useAsync'
import { useCurrentChain } from './useChains'
import { useWeb3ReadOnly } from './wallets/web3'
import { useDefaultGasPrice, type GasFeeParams } from '@safe-global/utils/hooks/useDefaultGasPrice'

// Hashio (Hedera's EVM JSON-RPC relay) quotes gas price in the standard 18-decimal
// "weibar" convention, same as any other EVM chain's wei — the real value below is exactly
// what execution actually gets billed and must be submitted with unchanged. HBAR's own
// 8-decimal display (chain.nativeCurrency.decimals) only matters when formatting a *fee total*
// (price x gasLimit) for the user — see getTotalFeeFormatted in useDefaultGasPrice.ts, which
// special-cases Hedera there instead of here.
const useGasPrice = (isSpeedUp: boolean = false): AsyncResult<GasFeeParams> => {
  const chain = useCurrentChain()
  const provider = useWeb3ReadOnly()

  const logError = useCallback((e: string) => {
    console.error(e)
  }, [])

  return useDefaultGasPrice(chain, provider, {
    isSpeedUp,
    withPooling: true,
    logError,
  })
}

export default useGasPrice
