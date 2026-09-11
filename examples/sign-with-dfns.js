// Runs each ISignerEvm operation against a real Dfns wallet. Nothing is broadcast.
// Run: node --env-file=.env examples/sign-with-dfns.js
import { Transaction, verifyAuthorization, verifyMessage, verifyTypedData } from 'ethers'
import WalletManagerEvm from '@tetherto/wdk-wallet-evm'
import { DfnsSignerEvm } from '../index.js'
import { clientFromEnv } from '../src/client.js'

const client = clientFromEnv()
const root = new DfnsSignerEvm({ client, masterKeyId: process.env.DFNS_MASTER_KEY_ID, network: process.env.DFNS_NETWORK || 'EthereumSepolia' })
const wallet = new WalletManagerEvm(root)
const account = await wallet.getAccount(0)
const address = await account.getAddress()
console.log('getAddress       ', address, account.path)

const sig = await account.sign('hello from wdk')
console.log('sign             ', verifyMessage('hello from wdk', sig) === address ? 'ok' : 'FAIL')

const signed = await account.signTransaction({
  chainId: 11155111, nonce: 0, to: address, value: 0n, data: '0x', type: 2,
  gasLimit: 21000n, maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n
})
console.log('signTransaction  ', Transaction.from(signed).from === address ? 'ok' : 'FAIL')

const typed = {
  domain: { name: 'WDK', version: '1', chainId: 11155111, verifyingContract: address },
  types: { Transfer: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }] },
  message: { to: address, amount: 42 }
}
const typedSig = await account.signTypedData(typed)
console.log('signTypedData    ', verifyTypedData(typed.domain, typed.types, typed.message, typedSig) === address ? 'ok' : 'FAIL')

const auth = await account.signAuthorization({ address, nonce: 1, chainId: 11155111 })
console.log('signAuthorization', verifyAuthorization(auth, auth.signature) === address ? 'ok' : 'FAIL')

const child = await wallet.getAccount(1)
console.log('derive           ', await child.getAddress(), child.path)

if (process.env.DFNS_WALLET_ID) {
  const single = new DfnsSignerEvm({ client, walletId: process.env.DFNS_WALLET_ID })
  wallet.addSigner('single', single)
  const a = await wallet.getAccount('single')
  console.log('addSigner        ', await a.getAddress(), 'derivable', single.isDerivable)
}
wallet.dispose()
