import type { WalletInit } from '@web3-onboard/common'
import { createEIP1193Provider } from '@web3-onboard/common'
import type { Chain } from '@safe-global/store/gateway/AUTO_GENERATED/chains'
import type { SessionTypes } from '@walletconnect/types'
import { WC_PROJECT_ID } from '@/config/constants'
import { isHederaChain } from '@/utils/hedera-chains'
import { numberToHex } from '@/utils/hex'
import { getRpcServiceUrl } from '@/hooks/wallets/web3'
import {
  getHederaEvmAddress,
  getHederaContractId,
  getHederaEvmTransactionHash,
  HEDERA_NETWORK_BY_CHAIN_ID,
} from '@/utils/hedera'
import type { TransactionResponseJSON } from '@hiero-ledger/sdk'

export const HASHPACK_MODULE_LABEL = 'HashPack'

// Conservative default gas for a Safe's approveHash(bytes32) call. Hedera has no
// eth_estimateGas equivalent for a not-yet-submitted native transaction, so a fixed ceiling is
// used when the caller didn't specify one — mirrors the ZK_SYNC_ON_CHAIN_SIGNATURE_GAS_LIMIT
// precedent in services/tx/tx-sender/dispatch.ts for other chains needing an explicit override.
const DEFAULT_APPROVE_HASH_GAS = 200_000

let currentChainId = ''

const hexToBytes = (hex: string): Uint8Array => {
  const clean = hex.replace(/^0x/, '')
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/**
 * HashPack is reached over WalletConnect, not an injected provider — there is no
 * `window.hashpack` to wrap.
 *
 * Hedera owners always approve Safe transactions on-chain via `approveHash()` (see `signTx`
 * in `components/tx/shared/hooks.ts`). Hedera accounts can be ED25519- or ECDSA-keyed, and
 * only ECDSA accounts can ever produce an `ecrecover`-valid EVM signature — so this module
 * never requests an eip155/`eth_sendTransaction`-style WalletConnect method (HashPack blocks
 * ED25519 accounts from a session that requires one). Instead, the only signing method this
 * provider exposes, `eth_sendTransaction`, is translated internally into a native Hedera
 * `ContractExecuteTransaction` submitted via `hedera_signAndExecuteTransaction` — a
 * key-type-agnostic Hedera-native call that works for both ECDSA and ED25519 accounts.
 *
 * Everything else — every standard read-only EVM RPC method (`eth_call`, `eth_getCode`,
 * `eth_blockNumber`, `eth_getBalance`, `eth_gasPrice`, …) — is proxied straight to the chain's
 * own public RPC endpoint (Hashio). HashPack has no EVM JSON-RPC of its own to ask, and several
 * callers (web3-onboard's balance lookup, ethers' `BrowserProvider`, the Safe creation flow)
 * call these directly against a connected wallet's own provider, not just this app's separate
 * read-only provider — so this module needs to be able to answer them all, not just the ones
 * discovered so far.
 */
const HashPackModule = (chainId: Chain['chainId'], rpcUri: Chain['rpcUri']): WalletInit => {
  currentChainId = chainId

  return () => {
    // Only show HashPack for Hedera chains
    if (!isHederaChain(chainId) || !WC_PROJECT_ID) {
      return null
    }

    return {
      label: HASHPACK_MODULE_LABEL,
      getIcon: async () => (await import('./icon')).default,
      getInterface: async () => {
        const network = HEDERA_NETWORK_BY_CHAIN_ID[currentChainId]
        if (!network) {
          throw new Error(`Unsupported Hedera chain: ${currentChainId}`)
        }

        const [
          {
            DAppConnector,
            HederaChainId,
            HederaJsonRpcMethod,
            HederaSessionEvent,
            accountAndLedgerFromSession,
            transactionToBase64String,
          },
          { LedgerId, Client, ContractId, ContractExecuteTransaction, TransactionId },
        ] = await Promise.all([import('@hashgraph/hedera-wallet-connect'), import('@hiero-ledger/sdk')])

        const hederaChainId = network === 'mainnet' ? HederaChainId.Mainnet : HederaChainId.Testnet
        const ledgerId = network === 'mainnet' ? LedgerId.MAINNET : LedgerId.TESTNET

        const dAppConnector = new DAppConnector(
          {
            name: 'Safe{Wallet}',
            description: 'Safe{Wallet} — Hedera',
            url: window.location.origin,
            icons: [`${window.location.origin}/images/logo-round.svg`],
          },
          ledgerId,
          WC_PROJECT_ID,
          // Native Hedera methods only — never an eip155/ECDSA-only method (see module doc comment above).
          Object.values(HederaJsonRpcMethod),
          [HederaSessionEvent.ChainChanged, HederaSessionEvent.AccountsChanged],
          [hederaChainId],
        )

        await dAppConnector.init({ logger: 'error' })

        const getAccountId = (s: SessionTypes.Struct): string | undefined => {
          try {
            return accountAndLedgerFromSession(s)[0]?.account?.toString()
          } catch {
            return undefined
          }
        }

        const resolveEvmAddress = async (s: SessionTypes.Struct): Promise<`0x${string}` | undefined> => {
          const accountId = getAccountId(s)
          if (!accountId) return undefined
          const evmAddress = await getHederaEvmAddress(network, accountId)
          return evmAddress as `0x${string}`
        }

        // Restore an already-approved session from a previous page load, if any.
        let session: SessionTypes.Struct | undefined = dAppConnector.walletConnectClient?.session
          .getAll()
          .find((s) => getAccountId(s) !== undefined)

        const accountsChangedListeners = new Set<(accounts: string[]) => void>()
        const chainChangedListeners = new Set<(chainId: string) => void>()

        const client = dAppConnector.walletConnectClient
        client?.on('session_delete', (event) => {
          if (session?.topic === event.topic) {
            session = undefined
            accountsChangedListeners.forEach((listener) => listener([]))
          }
        })
        client?.on('session_event', (event) => {
          const activeSession = session
          if (activeSession?.topic !== event.topic) return
          const { name } = event.params.event
          if (name === 'accountsChanged') {
            resolveEvmAddress(activeSession).then((address) => {
              accountsChangedListeners.forEach((listener) => listener(address ? [address] : []))
            })
          }
          if (name === 'chainChanged') {
            chainChangedListeners.forEach((listener) => listener(numberToHex(Number(currentChainId))))
          }
        })

        // Various callers — web3-onboard's own getBalance() helper, ethers' BrowserProvider
        // (network detection, gas estimation, tx-wait polling), and the Safe creation flow —
        // all call standard read-only EVM JSON-RPC methods (eth_call, eth_getCode,
        // eth_blockNumber, eth_getBlockByNumber, eth_gasPrice, eth_maxPriorityFeePerGas, etc.)
        // directly against a connected wallet's own provider, not just this app's separate
        // read-only provider. HashPack itself can't answer any of these (it only understands
        // native Hedera methods), so proxy anything not explicitly overridden below to the
        // chain's own public RPC endpoint (Hashio) — a real EVM-compatible JSON-RPC relay.
        const rpcUrl = getRpcServiceUrl(rpcUri)
        const rpcRequest = async (method: string, params: unknown[] = []): Promise<unknown> => {
          const response = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
          })
          const { result, error } = (await response.json()) as { result?: unknown; error?: { message: string } }
          if (error) {
            throw new Error(error.message)
          }
          return result
        }

        // findExtensions() (called inside the DAppConnector constructor above) populates
        // dAppConnector.extensions asynchronously via a postMessage round trip with the
        // extension's own content script — poll briefly rather than assuming it's already
        // settled by the time the user clicks "HashPack" (it normally is, but this call can
        // race construction if it happens right after page load). Bounded-attempts, same shape
        // as the mirror-node polling in getHederaEvmTransactionHash (utils/hedera.ts).
        const EXTENSION_DETECT_ATTEMPTS = 8
        const EXTENSION_DETECT_POLL_MS = 100

        const findHashPackExtension = async () => {
          for (let attempt = 0; attempt < EXTENSION_DETECT_ATTEMPTS; attempt++) {
            const found =
              dAppConnector.extensions.find((ext) => ext.available && /hashpack/i.test(ext.name ?? '')) ??
              dAppConnector.extensions.find((ext) => ext.available)
            if (found) return found
            await new Promise((resolve) => setTimeout(resolve, EXTENSION_DETECT_POLL_MS))
          }
          return undefined
        }

        const connect = async (): Promise<[`0x${string}`]> => {
          // Prefer connecting directly to an installed HashPack browser extension — it skips
          // WalletConnect's own generic QR/wallet-picker modal entirely (which otherwise shows
          // HashPack redundantly a second time) and goes straight to the extension's own
          // approval popup. Only fall back to the modal when no extension is detected (e.g. no
          // HashPack installed, or a mobile browser).
          const extension = await findHashPackExtension()
          session = extension ? await dAppConnector.connectExtension(extension.id) : await dAppConnector.openModal()
          const address = await resolveEvmAddress(session)
          if (!address) {
            throw new Error('HashPack did not approve a usable Hedera session. Please update HashPack and try again.')
          }
          return [address]
        }

        const sendApproveHashTransaction = async (params: {
          from?: string
          to: string
          data: string
          gas?: string | number
        }): Promise<string> => {
          if (!session) {
            throw new Error('HashPack not connected')
          }
          const accountId = getAccountId(session)
          if (!accountId) {
            throw new Error('HashPack not connected')
          }

          const gas = params.gas ? Number(params.gas) : DEFAULT_APPROVE_HASH_GAS

          // ContractId.fromEvmAddress() encodes both a contractNum (0) and an evmAddress on the
          // id, which relies on a protobuf `oneof` that doesn't reliably survive a serialize →
          // WalletConnect → deserialize round trip — HashPack ends up signing a transaction
          // targeting contract 0.0.0 instead of the intended one. Resolve the real native
          // contractNum-based id via the mirror node instead; see utils/hedera.ts for details.
          const contractId = await getHederaContractId(network, params.to)

          // Client.forName() has no operator account configured, so freezeWith can't
          // auto-derive a payer/TransactionId the way it would with a real client — it must be
          // set explicitly first (mirrors DAppSigner.populateTransaction's own internal pattern).
          const tx = new ContractExecuteTransaction()
            .setContractId(ContractId.fromString(contractId))
            .setGas(gas)
            .setFunctionParameters(hexToBytes(params.data))
            .setTransactionId(TransactionId.generate(accountId))
            .freezeWith(Client.forName(network))

          // The library's declared `SignAndExecuteTransactionResult` type wraps this in a full
          // JSON-RPC envelope (`{ id, jsonrpc, result }`), but the underlying WalletConnect
          // `signClient.request()` already unwraps it — DAppConnector/DAppSigner's own internal
          // code (dist/lib/dapp/DAppSigner.js) destructures fields directly with no `.result`,
          // confirming the declared type doesn't match the actual runtime shape.
          const result = (await dAppConnector.signAndExecuteTransaction({
            signerAccountId: `${hederaChainId}:${accountId}`,
            transactionList: transactionToBase64String(tx),
          })) as unknown as TransactionResponseJSON

          // `result.transactionHash` is Hedera's own SHA-384 transaction hash — a different
          // value entirely from the keccak-based hash EVM tooling (ethers' BrowserProvider
          // polling eth_getTransactionByHash to confirm a deployment, in particular) expects
          // back from eth_sendTransaction. Resolve the real EVM-equivalent hash instead.
          return getHederaEvmTransactionHash(network, result.transactionId)
        }

        return {
          provider: createEIP1193Provider(
            {
              on: (event: string, listener: (...args: unknown[]) => void) => {
                if (event === 'accountsChanged') {
                  accountsChangedListeners.add(listener as (accounts: string[]) => void)
                }
                if (event === 'chainChanged') {
                  chainChangedListeners.add(listener as (chainId: string) => void)
                }
              },

              request: async ({ method, params }: { method: string; params?: unknown[] }) => rpcRequest(method, params),

              disconnect: async () => {
                if (session) {
                  await dAppConnector.disconnect(session.topic).catch(() => undefined)
                  session = undefined
                }
              },
            },
            {
              eth_chainId: async () => numberToHex(Number(currentChainId)),
              eth_accounts: async () => {
                const address = session && (await resolveEvmAddress(session))
                return address ? [address] : []
              },
              eth_requestAccounts: async () => {
                const address = session && (await resolveEvmAddress(session))
                return address ? [address] : connect()
              },
              // @ts-expect-error — onboard types expect specific params
              eth_sendTransaction: async ({ params }: { params: [{ to: string; data: string; gas?: string }] }) => {
                if (!session) {
                  await connect()
                }
                return sendApproveHashTransaction(params[0])
              },
            },
          ),
        }
      },
      platforms: ['desktop'],
    }
  }
}

export default HashPackModule
