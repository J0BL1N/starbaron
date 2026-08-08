import { describe, expect, it } from 'vitest'
import {
  createPlayer,
  startWallet,
  walletAdd,
  walletSpend,
} from '../src/sim/player'
import { loadSave, saveGame } from '../src/ui/save'
import { makeSave, MemoryStorage } from './saveHelpers'

const NOW = 1_700_000_000_000

describe('P2-T03-C wallet negative paths', () => {
  it('spend insufficient throws RangeError and leaves the wallet untouched', () => {
    const wallet = startWallet()
    const before = { ...wallet }
    expect(() => walletSpend(wallet, 2_000, 0)).toThrow(RangeError)
    expect(() => walletSpend(wallet, 0, 1)).toThrow(/insufficient funds/)
    expect(() => walletSpend(wallet, 1_000, 1)).toThrow(RangeError)
    expect(wallet).toEqual(before)
  })

  it('spending exactly the balance lands on 0, never negative', () => {
    const wallet = startWallet()
    const spent = walletSpend(wallet, wallet.credits, 0)
    expect(spent.credits).toBe(0)
    expect(spent.alloys).toBe(0)
  })

  it('spending exactly both currencies lands both at 0', () => {
    const wallet = walletAdd(startWallet(), { alloys: 500 })
    const spent = walletSpend(wallet, 1_000, 500)
    expect(spent.credits).toBe(0)
    expect(spent.alloys).toBe(0)
  })

  it('add then spend round-trips cleanly', () => {
    const wallet = walletAdd(startWallet(), { credits: 500, alloys: 100 })
    const spent = walletSpend(wallet, 300, 40)
    expect(spent.credits).toBe(1_200)
    expect(spent.alloys).toBe(60)
  })

  it('rejects negative or non-finite deltas and spend amounts', () => {
    expect(() => walletAdd(startWallet(), { credits: -1 })).toThrow(RangeError)
    expect(() => walletAdd(startWallet(), { population: Number.NaN })).toThrow(
      RangeError,
    )
    expect(() => walletAdd(startWallet(), { garrison: Number.POSITIVE_INFINITY })).toThrow(
      RangeError,
    )
    expect(() => walletSpend(startWallet(), -5, 0)).toThrow(RangeError)
    expect(() => walletSpend(startWallet(), Number.POSITIVE_INFINITY, 0)).toThrow(
      RangeError,
    )
  })

  it('a long add/spend lifecycle never produces a negative balance', () => {
    let wallet = startWallet()
    for (let i = 0; i < 20; i += 1) {
      wallet = walletAdd(wallet, { credits: 100 })
    }
    while (wallet.credits >= 10) {
      wallet = walletSpend(wallet, 10, 0)
    }
    expect(wallet.credits).toBe(0)
    expect(Object.values(wallet).every((value) => value >= 0)).toBe(true)
  })
})

describe('P2-T03-C wallet survives save/load in PlayerState', () => {
  it('round-trips a spent wallet through saveGame/loadSave unchanged', () => {
    const player = createPlayer('wallet-save-deep', NOW)
    const grown = walletSpend(walletAdd(player.wallet, { credits: 4_000, alloys: 200 }), 300, 50)
    const storage = new MemoryStorage()
    expect(
      saveGame(makeSave({ player: { playerId: 'wallet-save-deep', wallet: grown } }), storage),
    ).toBe(true)

    const result = loadSave(storage)
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.save.player.wallet).toEqual(grown)
      expect(result.save.player.wallet.credits).toBe(4_700)
      expect(result.save.player.wallet.alloys).toBe(150)
      expect(result.save.player.wallet.population).toBe(1_000)
      expect(result.save.player.wallet.garrison).toBe(0)
      expect(result.save.player.wallet.fleet).toBe(0)
    }
  })

  it('the persisted wallet stays free of negative values after a full lifecycle', () => {
    const player = createPlayer('wallet-save-lifecycle', NOW)
    const lifecycle = walletSpend(walletAdd(player.wallet, { credits: 10_000 }), 9_999, 0)
    const storage = new MemoryStorage()
    expect(
      saveGame(makeSave({ player: { playerId: 'wallet-save-lifecycle', wallet: lifecycle } }), storage),
    ).toBe(true)

    const result = loadSave(storage)
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.save.player.wallet.credits).toBe(1_001)
      expect(Object.values(result.save.player.wallet).every((v) => v >= 0)).toBe(
        true,
      )
    }
  })
})
