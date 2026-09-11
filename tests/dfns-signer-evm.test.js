import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { HDNodeWallet, Transaction, verifyAuthorization, verifyMessage, verifyTypedData } from 'ethers'
import { ISigner } from '@tetherto/wdk-wallet'
import WalletManagerEvm, { WalletAccountEvm } from '@tetherto/wdk-wallet-evm'
import { DfnsSignerEvm } from '../index.js'
import { FakeDfnsClient } from './fake-dfns-client.js'

// the usual hardhat test mnemonic
const MNEMONIC = 'test test test test test test test test test test test junk'
const NETWORK = 'EthereumSepolia'
const root = HDNodeWallet.fromPhrase(MNEMONIC, undefined, 'm')
const local = (rel) => root.derivePath(`44/60/${rel}`)

const TX = { chainId: 11155111, nonce: 7, to: '0x000000000000000000000000000000000000dEaD', value: 1000n, data: '0x', type: 2, gasLimit: 21000n, maxFeePerGas: 30n * 10n ** 9n, maxPriorityFeePerGas: 10n ** 9n }
const TYPED = {
  domain: { name: 'WDK', version: '1', chainId: 11155111, verifyingContract: '0x000000000000000000000000000000000000dEaD' },
  types: { Transfer: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }] },
  message: { to: '0x000000000000000000000000000000000000dEaD', amount: 42 }
}

describe('DfnsSignerEvm, derivable root on a master key', () => {
  let client, signer
  before(() => { client = new FakeDfnsClient(MNEMONIC); signer = new DfnsSignerEvm({ client, masterKeyId: 'key-master', network: NETWORK }) })

  it('extends the base ISigner and has the ISignerEvm shape', () => {
    assert.ok(signer instanceof ISigner)
    for (const m of ['derive', 'getAddress', 'sign', 'signTransaction', 'signTypedData', 'signAuthorization', 'dispose']) assert.equal(typeof signer[m], 'function', m)
    for (const g of ['isDerivable', 'index', 'path', 'address', 'keyPair']) assert.ok(g in signer, g)
  })

  it('needs a client and either a wallet or a master key with a network', () => {
    assert.throws(() => new DfnsSignerEvm({ masterKeyId: 'k', network: NETWORK }), /client/)
    assert.throws(() => new DfnsSignerEvm({ client }), /walletId/)
    assert.throws(() => new DfnsSignerEvm({ client, masterKeyId: 'k' }), /network/)
  })

  it('uses non-hardened paths under 44/60', () => {
    assert.equal(signer.isDerivable, true)
    assert.equal(signer.path, '44/60/0/0/0')
    assert.equal(signer.index, 0)
    assert.equal(signer.address, undefined)
    const s = new DfnsSignerEvm({ client, masterKeyId: 'key-master', network: NETWORK, path: "0'/0/3" })
    assert.equal(s.path, '44/60/0/0/3')
  })

  it('creates the derived wallet on first getAddress, then finds it again by path', async () => {
    const address = await signer.getAddress()
    assert.equal(address, local('0/0/0').address)
    assert.deepEqual(client.calls, ['createWallet'])
    const again = new DfnsSignerEvm({ client, masterKeyId: 'key-master', network: NETWORK })
    assert.equal(await again.getAddress(), address)
    assert.deepEqual(client.calls.slice(1), ['createWallet', 'listKeys', 'getKey', 'getWallet'])
    assert.equal(client.wallets.length, 1)
  })

  it('exposes the compressed public key and no private key', async () => {
    await signer.getAddress()
    assert.equal(signer.keyPair.privateKey, null)
    assert.equal(Buffer.from(signer.keyPair.publicKey).toString('hex'), local('0/0/0').publicKey.slice(2))
  })

  it('signs a message with kind Eip191', async () => {
    const sig = await signer.sign('hello wdk')
    assert.equal(client.calls.at(-1), 'generateSignature:Eip191')
    assert.equal(verifyMessage('hello wdk', sig), await signer.getAddress())
  })

  it('signs a transaction with kind Transaction and returns signedData', async () => {
    const from = await signer.getAddress()
    const signed = await signer.signTransaction({ from, ...TX })
    assert.equal(client.calls.at(-1), 'generateSignature:Transaction')
    const tx = Transaction.from(signed)
    assert.equal(tx.from, from)
    assert.equal(tx.nonce, 7)
    assert.equal(tx.value, 1000n)
  })

  it('rejects a transaction whose from is another address', async () => {
    await assert.rejects(signer.signTransaction({ from: local('0/0/5').address, ...TX }), /does not match/)
  })

  it('signs typed data with kind Eip712, without the EIP712Domain type', async () => {
    const sig = await signer.signTypedData(TYPED)
    assert.equal(client.calls.at(-1), 'generateSignature:Eip712')
    assert.equal(verifyTypedData(TYPED.domain, TYPED.types, TYPED.message, sig), await signer.getAddress())
  })

  it('signs a 7702 authorization with kind Eip7702', async () => {
    const auth = await signer.signAuthorization({ address: TX.to, nonce: 3, chainId: 11155111 })
    assert.equal(client.calls.at(-1), 'generateSignature:Eip7702')
    assert.equal(auth.nonce, 3n)
    assert.equal(verifyAuthorization(auth, auth.signature), await signer.getAddress())
  })

  it('derives children that get their own wallet and cannot derive further', async () => {
    const child = await signer.derive("0'/0/3")
    assert.equal(child.isDerivable, false)
    assert.equal(child.index, 3)
    assert.equal(await child.getAddress(), local('0/0/3').address)
    await assert.rejects(child.derive('0/0/4'), /Cannot derive/)
  })

  it('refuses to work after dispose', async () => {
    const s = new DfnsSignerEvm({ client, masterKeyId: 'key-master', network: NETWORK, path: '0/0/9' })
    s.dispose()
    await assert.rejects(s.getAddress(), /disposed/)
  })
})

describe('DfnsSignerEvm bound to one wallet', () => {
  it('is not derivable and resolves the wallet address', async () => {
    const client = new FakeDfnsClient(MNEMONIC)
    const w = await client.wallets.createWallet({ body: { network: NETWORK } })
    const signer = new DfnsSignerEvm({ client, walletId: w.id })
    assert.equal(signer.isDerivable, false)
    assert.equal(signer.path, undefined)
    assert.equal(signer.index, undefined)
    assert.equal((await signer.getAddress()).toLowerCase(), w.address)
    await assert.rejects(signer.derive('0/0/1'), /Cannot derive/)
    assert.throws(() => new WalletManagerEvm(signer), /derivable/)
  })
})

describe('DfnsSignerEvm inside wdk-wallet-evm', () => {
  it('backs a WalletManagerEvm as the default signer', async () => {
    const client = new FakeDfnsClient(MNEMONIC)
    const manager = new WalletManagerEvm(new DfnsSignerEvm({ client, masterKeyId: 'key-master', network: NETWORK }))
    const account = await manager.getAccount(2)
    assert.ok(account instanceof WalletAccountEvm)
    assert.equal(await account.getAddress(), local('0/0/2').address)
    assert.equal(account.path, '44/60/0/0/2')
    const sig = await account.sign('from the manager')
    assert.equal(verifyMessage('from the manager', sig), local('0/0/2').address)
    manager.dispose()
  })

  it('takes a single-wallet signer through addSigner and getAccount(name)', async () => {
    const client = new FakeDfnsClient(MNEMONIC)
    const w = await client.wallets.createWallet({ body: { network: NETWORK } })
    const manager = new WalletManagerEvm(MNEMONIC)
    manager.addSigner('dfns', new DfnsSignerEvm({ client, walletId: w.id }))
    const account = await manager.getAccount('dfns')
    assert.equal((await account.getAddress()).toLowerCase(), w.address)
    const signed = await account.signTransaction(TX)
    assert.equal(Transaction.from(signed).from.toLowerCase(), w.address)
    const auth = await account.signAuthorization({ address: TX.to, nonce: 0, chainId: 11155111 })
    assert.equal(verifyAuthorization(auth, auth.signature).toLowerCase(), w.address)
    assert.equal(account.keyPair.privateKey, null)
    manager.dispose()
  })
})
