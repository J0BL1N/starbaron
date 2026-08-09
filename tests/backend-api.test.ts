import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  claimColony,
  claimHomePlanet,
  getAttack,
  getGalaxy,
  getPlayerState,
  joinAttack,
  launchAttack,
} from '../src/backend/api'
import type { AttackReport, AttackRow, GalaxyResponse, PlayerStateResponse } from '../src/backend/api'
import { PVP_CONSTANTS } from '../src/sim/player/estimator'

// Fake supabase-js client: rpc() only — no network (P3-T02-B RESTRICTIONS).
function mockClient(handler: (name: string, args: unknown) => unknown) {
  const rpc = vi.fn(
    async (name: string, args: unknown): Promise<{ data: unknown; error: { message: string } | null }> => {
      const data = handler(name, args)
      return { data, error: null }
    },
  )
  const client = { rpc } as unknown as SupabaseClient
  return { client, rpc }
}

const SAMPLE_PLAYER_STATE: PlayerStateResponse = {
  player_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  wallet: {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    display_name: '',
    credits: 1000,
    alloys: 0,
    last_seen_at: '2026-08-09T00:00:00Z',
    created_at: '2026-08-09T00:00:00Z',
  },
  owned_planets: [],
  attacks: [],
  unread_notifications: [],
  resolved: [],
}

const SAMPLE_ATTACK: AttackRow = {
  id: '11111111-1111-4111-8111-111111111111',
  target_planet_name: 'beta-colony',
  launcher_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  defender_id: null,
  status: 'inbound',
  outcome: null,
  winner_id: null,
  launched_at: '2026-08-09T00:00:00Z',
  join_window_seconds: 7200,
  travel_seconds: 6000,
  resolves_at: '2026-08-09T01:40:00Z',
  resolved_at: null,
  attack_report: null,
}

const SAMPLE_REPORT: AttackReport = {
  attack_id: SAMPLE_ATTACK.id,
  target_planet_name: 'beta-colony',
  launched_at: '2026-08-09T00:00:00Z',
  resolved_at: '2026-08-09T01:40:00Z',
  ratio: 26.6667,
  outcome: 'decisive',
  combined_ap: 4000,
  defense_power: 150,
  war_weariness_multiplier: 1,
  planet_taken: true,
  winner_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  members: [
    {
      player_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      soldiers_committed: 1000,
      shipyard_tier: 3,
      ap: 3000,
      losses: 400,
    },
  ],
  defender: { player_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', population_before: 1000, population_after: 0 },
}

describe('P3-T02-B api — read RPC wrappers', () => {
  it('getPlayerState calls rpc("get_player_state") with no args and returns the typed payload', async () => {
    const { client, rpc } = mockClient((name) =>
      name === 'get_player_state' ? SAMPLE_PLAYER_STATE : null,
    )
    const result = await getPlayerState(client)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('get_player_state', {})
    expect(result).toEqual(SAMPLE_PLAYER_STATE)
  })

  it('getGalaxy calls rpc("get_galaxy") with no args', async () => {
    const galaxy: GalaxyResponse = {
      current_player_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      planets: [],
      my_weariness: 1,
      pvp: { ...PVP_CONSTANTS },
      resolved: [],
    }
    const { client, rpc } = mockClient((name) =>
      name === 'get_galaxy' ? galaxy : null,
    )
    const result = await getGalaxy(client)
    expect(rpc).toHaveBeenCalledWith('get_galaxy', {})
    expect(result.current_player_id).toBe(galaxy.current_player_id)
  })

  it('getAttack passes the p_attack_id arg shape', async () => {
    const { client, rpc } = mockClient((name, args) =>
      name === 'get_attack' && (args as { p_attack_id: string }).p_attack_id === SAMPLE_ATTACK.id
        ? { found: true, attack: SAMPLE_ATTACK, members: [], report: SAMPLE_REPORT }
        : { found: false },
    )
    const result = await getAttack(SAMPLE_ATTACK.id, client)
    expect(rpc).toHaveBeenCalledWith('get_attack', { p_attack_id: SAMPLE_ATTACK.id })
    expect(result.found).toBe(true)
    expect(result.report?.outcome).toBe('decisive')
  })
})

describe('P3-T02-B api — write RPC wrappers', () => {
  it('launchAttack passes the p_ target/soldiers/source arg shape', async () => {
    const { client, rpc } = mockClient(() => SAMPLE_ATTACK)
    const result = await launchAttack(
      { targetPlanetName: 'beta-colony', soldiers: 1000, sourcePlanetName: 'alpha-colony' },
      client,
    )
    expect(rpc).toHaveBeenCalledWith('launch_attack', {
      p_target_planet_name: 'beta-colony',
      p_soldiers: 1000,
      p_source_planet_name: 'alpha-colony',
    })
    expect('launched' in result).toBe(false)
  })

  it('launchAttack surfaces the attack_in_flight union for band-together routing', async () => {
    const { client, rpc } = mockClient(() => ({
      launched: false,
      reason: 'attack_in_flight',
      join_attack_id: '22222222-2222-4222-8222-222222222222',
    }))
    const result = await launchAttack(
      { targetPlanetName: 'beta-colony', soldiers: 100, sourcePlanetName: 'alpha-colony' },
      client,
    )
    expect(rpc).toHaveBeenCalledTimes(1)
    if ('launched' in result) {
      expect(result.launched).toBe(false)
      expect(result.reason).toBe('attack_in_flight')
      expect(result.join_attack_id).toBe('22222222-2222-4222-8222-222222222222')
    } else {
      throw new Error('expected the attack_in_flight union branch')
    }
  })

  it('joinAttack passes the p_attack_id/soldiers/source arg shape', async () => {
    const { client, rpc } = mockClient(() => SAMPLE_ATTACK)
    const result = await joinAttack(
      { attackId: SAMPLE_ATTACK.id, soldiers: 500, sourcePlanetName: 'gamma-colony' },
      client,
    )
    expect(rpc).toHaveBeenCalledWith('join_attack', {
      p_attack_id: SAMPLE_ATTACK.id,
      p_soldiers: 500,
      p_source_planet_name: 'gamma-colony',
    })
    expect(result.id).toBe(SAMPLE_ATTACK.id)
  })

  it('claimHomePlanet passes the snake p_ arg shape with defaults', async () => {
    const { client, rpc } = mockClient(() => ({ claimed: false, reason: 'planet_taken' }))
    const result = await claimHomePlanet({ planetName: 'alpha', tier: 2 }, client)
    expect(rpc).toHaveBeenCalledWith('claim_home_planet', {
      p_planet_name: 'alpha',
      p_tier: 2,
      p_distance_pc: null,
      p_massive_world: false,
      p_dense_core: false,
    })
    expect(result).toEqual({ claimed: false, reason: 'planet_taken' })
  })

  it('claimColony passes through explicit optional args', async () => {
    const { client, rpc } = mockClient((name, args) =>
      name === 'claim_colony' ? { ...(args as object) } : null,
    )
    await claimColony(
      { planetName: 'beta', tier: 3, distancePc: 5, massiveWorld: true, denseCore: true },
      client,
    )
    expect(rpc).toHaveBeenCalledWith('claim_colony', {
      p_planet_name: 'beta',
      p_tier: 3,
      p_distance_pc: 5,
      p_massive_world: true,
      p_dense_core: true,
    })
  })
})

describe('P3-T02-B api — error paths', () => {
  it('propagates a Postgrest error as a thrown Error with the RPC name', async () => {
    const { client, rpc } = mockClient(() => {
      throw new Error('boom')
    })
    // simulate the postgrest error branch instead of a throwing handler
    rpc.mockImplementationOnce(async () => ({ data: null, error: { message: 'permission denied' } }))
    await expect(getPlayerState(client)).rejects.toThrow(/get_player_state: permission denied/)
  })

  it('throws a clear configuration error when no client is available', async () => {
    // no client arg + no env-configured client (vitest node env has no
    // VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) -> requireClient throws.
    await expect(getPlayerState()).rejects.toThrow(/Supabase not configured/)
  })
})
