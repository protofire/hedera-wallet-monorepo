import type { MetaTransactionData } from '@safe-global/types-kit'
import { Interface } from 'ethers'
import { HTS_PRECOMPILE_ADDRESS } from '@/utils/hedera'

const HTS_ABI = ['function associateToken(address account, address token) external returns (int64 responseCode)']

/**
 * Builds a Safe transaction calling the Hedera Token Service (HTS) system contract's
 * `associateToken(address account, address token)` — necessary before a Safe can hold an HTS
 * token at all (there's no receiver-hook equivalent that would let it auto-associate).
 *
 * Selector and parameter order confirmed against a live HTS association transaction this
 * session: `0x49146bde` + the Safe's own address + the token's long-zero address, in that order.
 */
export const createAssociateTokenTx = (safeAddress: string, tokenEvmAddress: string): MetaTransactionData => {
  const hts = new Interface(HTS_ABI)
  return {
    to: HTS_PRECOMPILE_ADDRESS,
    value: '0',
    data: hts.encodeFunctionData('associateToken', [safeAddress, tokenEvmAddress]),
  }
}
