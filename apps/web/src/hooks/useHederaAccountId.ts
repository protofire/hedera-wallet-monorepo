import useAsync from '@safe-global/utils/hooks/useAsync'
import { isHederaChain, getHederaAccountId, HEDERA_NETWORK_BY_CHAIN_ID, type HederaNetwork } from '@/utils/hedera'

/**
 * Resolves a Hedera owner's native account id (`0.0.X`) from their 0x address, for display
 * alongside the address — the Hedera equivalent of Tron's base58 address (see `useTronAddress`).
 * Undefined on non-Hedera chains, or while the mirror-node lookup is in flight.
 */
const useHederaAccountId = (
  address: string,
  chainId: string,
): { accountId?: string; network?: HederaNetwork; isHedera: boolean } => {
  const network = HEDERA_NETWORK_BY_CHAIN_ID[chainId]
  const isHedera = isHederaChain(chainId)

  const [accountId] = useAsync(() => {
    if (!isHedera || !network) return undefined
    return getHederaAccountId(network, address)
  }, [isHedera, network, address])

  return { accountId, network, isHedera }
}

export default useHederaAccountId
