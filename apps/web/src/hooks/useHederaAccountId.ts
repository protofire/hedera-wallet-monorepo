import useAsync from '@safe-global/utils/hooks/useAsync'
import { FEATURES, hasFeature } from '@safe-global/utils/utils/chains'
import { getHederaAccountId, type HederaNetwork } from '@/utils/hedera'
import { useChain } from './useChains'

/**
 * Resolves a Hedera owner's native account id (`0.0.X`) from their 0x address, for display
 * alongside the address — the Hedera equivalent of Tron's base58 address (see `useTronAddress`).
 * Undefined on non-Hedera chains, or while the mirror-node lookup is in flight.
 */
const useHederaAccountId = (
  address: string,
  chainId: string,
): { accountId?: string; network?: HederaNetwork; isHedera: boolean } => {
  const chain = useChain(chainId)
  const isHedera = !!chain && hasFeature(chain, FEATURES.HEDERA)
  const network: HederaNetwork | undefined = isHedera ? (chain?.isTestnet ? 'testnet' : 'mainnet') : undefined

  const [accountId] = useAsync(() => {
    if (!isHedera || !network) return undefined
    return getHederaAccountId(network, address)
  }, [isHedera, network, address])

  return { accountId, network, isHedera }
}

export default useHederaAccountId
