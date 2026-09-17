export { isHederaChain } from './hedera-chains'

export type HederaNetwork = 'mainnet' | 'testnet'

export const HEDERA_NETWORK_BY_CHAIN_ID: Record<string, HederaNetwork> = {
  '295': 'mainnet',
  '296': 'testnet',
}

const MIRROR_NODE_BASE_URL: Record<HederaNetwork, string> = {
  mainnet: 'https://mainnet-public.mirrornode.hedera.com',
  testnet: 'https://testnet.mirrornode.hedera.com',
}

/** The Hedera Token Service (HTS) system contract, at native entity id `0.0.359`. */
export const HTS_PRECOMPILE_ADDRESS = '0x0000000000000000000000000000000000000167'

const HEDERA_ENTITY_ID_REGEX = /^0\.0\.\d+$/

/** Matches a native Hedera entity id (`shard.realm.num`, shard/realm always 0 in practice) — the
 * same shape for accounts, contracts, and tokens. */
export const isHederaAccountId = (value: string): boolean => HEDERA_ENTITY_ID_REGEX.test(value.trim())

/**
 * Converts a native Hedera entity id (`0.0.X`) into its deterministic "long-zero" EVM address —
 * pure/offline, no network call. Valid for entities with no real EVM alias: HTS tokens always
 * take this form (mirror node's token schema has no `evm_address` field at all), and it's also
 * the fallback form for accounts/contracts that haven't been given a real ECDSA-derived alias.
 */
export const hederaEntityIdToEvmAddress = (entityId: string): string => {
  const num = entityId.trim().split('.').at(-1) ?? '0'
  return `0x${BigInt(num).toString(16).padStart(40, '0')}`
}

/**
 * HashScan's native-account explorer URL — distinct from the chain config's own
 * `blockExplorerUriTemplate`, which only covers 0x address/tx-hash patterns, not `0.0.X` ids.
 */
export const getHederaAccountExplorerLink = (network: HederaNetwork, accountId: string): string =>
  `https://hashscan.io/${network}/account/${accountId}`

/**
 * HashScan's native-token explorer URL — HTS tokens are served at a distinct `/token/` path, not
 * `/account/` (the chain config's generic `blockExplorerUriTemplate`, and `getHederaAccountExplorerLink`
 * above, both point at the account path — wrong for a token's own EVM address).
 */
export const getHederaTokenExplorerLink = (network: HederaNetwork, evmAddress: string): string =>
  `https://hashscan.io/${network}/token/${evmAddress}`

interface MirrorNodeAccount {
  account?: string
  evm_address?: string
}

const fetchMirrorNodeAccount = async (network: HederaNetwork, idOrAddress: string): Promise<MirrorNodeAccount> => {
  const response = await fetch(`${MIRROR_NODE_BASE_URL[network]}/api/v1/accounts/${idOrAddress}`)
  if (!response.ok) {
    throw new Error(`Failed to resolve Hedera account ${idOrAddress}: mirror node returned ${response.status}`)
  }
  return (await response.json()) as MirrorNodeAccount
}

const evmAddressCache = new Map<string, string>()

/**
 * Resolves the stable 0x EVM-alias address for a Hedera account (given its native `0.0.X` id)
 * via the public mirror-node REST API. This works for both ECDSA accounts (a real derived
 * alias) and ED25519/no-alias accounts (a deterministic "long-zero" address Hedera synthesizes
 * from the account number) — Safe just needs a stable per-owner 0x identifier, not a "real"
 * EVM key.
 */
export const getHederaEvmAddress = async (network: HederaNetwork, accountId: string): Promise<string> => {
  const cacheKey = `${network}:${accountId}`
  const cached = evmAddressCache.get(cacheKey)
  if (cached) return cached

  const data = await fetchMirrorNodeAccount(network, accountId)
  if (!data.evm_address) {
    throw new Error(`Hedera account ${accountId} has no evm_address`)
  }

  evmAddressCache.set(cacheKey, data.evm_address)
  return data.evm_address
}

const accountIdCache = new Map<string, string>()

/**
 * Resolves the native Hedera account id (`0.0.X`) for a given 0x EVM-alias address, via the
 * public mirror-node REST API (which accepts either form as the lookup key) — the reverse of
 * `getHederaEvmAddress`. Used to show a Hedera owner's native account id alongside their 0x
 * address, the same way Tron shows a base58 address alongside its 0x form (see `utils/tron.ts`).
 */
export const getHederaAccountId = async (network: HederaNetwork, evmAddress: string): Promise<string> => {
  const cacheKey = `${network}:${evmAddress}`
  const cached = accountIdCache.get(cacheKey)
  if (cached) return cached

  const data = await fetchMirrorNodeAccount(network, evmAddress)
  if (!data.account) {
    throw new Error(`No Hedera account found for ${evmAddress}`)
  }

  accountIdCache.set(cacheKey, data.account)
  return data.account
}

const contractIdCache = new Map<string, string>()

/**
 * Resolves the native Hedera contract id (`0.0.X`) for a given 0x EVM address, via the public
 * mirror-node REST API. Every EVM contract on Hedera has one — use this instead of
 * `ContractId.fromEvmAddress()` when building a `ContractExecuteTransaction`: the SDK's
 * `evmAddress`-based `ContractId` relies on a protobuf `oneof` alongside `contractNum` that
 * doesn't reliably survive a serialize → WalletConnect → deserialize round trip (observed: the
 * wallet ends up signing a transaction targeting contract `0.0.0` instead of the intended
 * contract). A plain `contractNum`-based id has no such ambiguity.
 */
export const getHederaContractId = async (network: HederaNetwork, evmAddress: string): Promise<string> => {
  const cacheKey = `${network}:${evmAddress}`
  const cached = contractIdCache.get(cacheKey)
  if (cached) return cached

  const response = await fetch(`${MIRROR_NODE_BASE_URL[network]}/api/v1/contracts/${evmAddress}`)
  if (!response.ok) {
    throw new Error(`Failed to resolve Hedera contract ${evmAddress}: mirror node returned ${response.status}`)
  }
  const data = (await response.json()) as { contract_id?: string }
  if (!data.contract_id) {
    throw new Error(`No Hedera contract found for ${evmAddress}`)
  }

  contractIdCache.set(cacheKey, data.contract_id)
  return data.contract_id
}

/**
 * Converts a Hedera SDK `TransactionId` string (`shard.realm.num@seconds.nanos`) into the
 * mirror node's own transaction-id format (`shard.realm.num-seconds-nanos`).
 */
const toMirrorNodeTransactionId = (transactionId: string): string => {
  const [entityId, validStart] = transactionId.split('@')
  const [seconds, nanos] = validStart.split('.')
  return `${entityId}-${seconds}-${nanos}`
}

const TRANSACTION_RECEIPT_POLL_ATTEMPTS = 10
const TRANSACTION_RECEIPT_POLL_INTERVAL_MS = 1500

/**
 * Resolves the real EVM-equivalent transaction hash for a Hedera transaction, by polling the
 * mirror node's contract-results endpoint until the record is indexed. A native Hedera
 * transaction's own hash (`TransactionResponse.transactionHash`, a SHA-384 digest) is a
 * different value entirely from the keccak-based hash the EVM JSON-RPC world expects back from
 * `eth_sendTransaction` — callers (e.g. ethers' `BrowserProvider` polling `eth_getTransactionByHash`
 * to confirm a deployment) need this one, not the native one.
 */
export const getHederaEvmTransactionHash = async (network: HederaNetwork, transactionId: string): Promise<string> => {
  const mirrorNodeTransactionId = toMirrorNodeTransactionId(transactionId)

  for (let attempt = 0; attempt < TRANSACTION_RECEIPT_POLL_ATTEMPTS; attempt++) {
    const response = await fetch(`${MIRROR_NODE_BASE_URL[network]}/api/v1/contracts/results/${mirrorNodeTransactionId}`)
    if (response.ok) {
      const data = (await response.json()) as { hash?: string }
      if (data.hash) return data.hash
    }
    await new Promise((resolve) => setTimeout(resolve, TRANSACTION_RECEIPT_POLL_INTERVAL_MS))
  }

  throw new Error(`Timed out waiting for Hedera transaction ${transactionId} to be indexed`)
}

export type HederaTokenType = 'FUNGIBLE_COMMON' | 'NON_FUNGIBLE_UNIQUE'

export interface HederaTokenMetadata {
  tokenId: string
  evmAddress: string
  name: string
  symbol: string
  decimals: number
  type: HederaTokenType
  deleted: boolean
}

/**
 * Resolves an HTS token's metadata given either its native id (`0.0.X`) or its (long-zero) 0x
 * address — the mirror node's `/tokens` endpoint accepts either form directly. Used both to show
 * a "selected token to associate" confirmation card, and to validate the user's input actually
 * names a real, non-deleted token before letting them proceed.
 */
export type HederaFreezeStatus = 'NOT_APPLICABLE' | 'FROZEN' | 'UNFROZEN'

export interface HederaAssociatedToken {
  tokenId: string
  evmAddress: string
  balance: number
  decimals: number
  freezeStatus: HederaFreezeStatus
  createdAt: Date
}

interface MirrorNodeAccountToken {
  token_id: string
  balance: number
  decimals: number
  freeze_status: HederaFreezeStatus
  created_timestamp: string
}

const ASSOCIATED_TOKENS_MAX_PAGES = 10

/**
 * Lists every HTS token associated with an account (given its native id or 0x/EVM address), via
 * the mirror node's `/accounts/{id}/tokens` endpoint — used to render the Settings "Token
 * Association" table (mirrors the reference Hedera fork's own accounts/tokens listing). Follows
 * `links.next` pagination, bounded, the same defensive-bounding style as the polling loop in
 * `getHederaEvmTransactionHash`.
 */
export const getHederaAssociatedTokens = async (
  network: HederaNetwork,
  accountIdOrEvmAddress: string,
): Promise<HederaAssociatedToken[]> => {
  const tokens: MirrorNodeAccountToken[] = []
  let path: string | null = `/api/v1/accounts/${accountIdOrEvmAddress}/tokens`

  for (let page = 0; page < ASSOCIATED_TOKENS_MAX_PAGES && path; page++) {
    const response = await fetch(`${MIRROR_NODE_BASE_URL[network]}${path}`)
    if (!response.ok) {
      throw new Error(
        `Failed to fetch Hedera token associations for ${accountIdOrEvmAddress}: mirror node returned ${response.status}`,
      )
    }
    const data = (await response.json()) as { tokens?: MirrorNodeAccountToken[]; links?: { next?: string | null } }
    tokens.push(...(data.tokens ?? []))
    path = data.links?.next ?? null
  }

  return tokens.map((token) => ({
    tokenId: token.token_id,
    evmAddress: hederaEntityIdToEvmAddress(token.token_id),
    balance: token.balance,
    decimals: token.decimals,
    freezeStatus: token.freeze_status,
    createdAt: new Date(Number(token.created_timestamp.split('.')[0]) * 1000),
  }))
}

export const getHederaTokenMetadata = async (
  network: HederaNetwork,
  idOrEvmAddress: string,
): Promise<HederaTokenMetadata> => {
  const response = await fetch(`${MIRROR_NODE_BASE_URL[network]}/api/v1/tokens/${idOrEvmAddress}`)
  if (!response.ok) {
    throw new Error(`Failed to resolve Hedera token ${idOrEvmAddress}: mirror node returned ${response.status}`)
  }
  const data = (await response.json()) as {
    token_id?: string
    name?: string
    symbol?: string
    decimals?: string
    type?: HederaTokenType
    deleted?: boolean
  }
  if (!data.token_id) {
    throw new Error(`No Hedera token found for ${idOrEvmAddress}`)
  }

  return {
    tokenId: data.token_id,
    evmAddress: hederaEntityIdToEvmAddress(data.token_id),
    name: data.name ?? '',
    symbol: data.symbol ?? '',
    decimals: Number(data.decimals ?? 0),
    type: data.type ?? 'FUNGIBLE_COMMON',
    deleted: data.deleted ?? false,
  }
}
