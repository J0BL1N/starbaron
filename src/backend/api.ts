import type { SupabaseClient } from '@supabase/supabase-js'
import type { PvpConstants } from '../sim/player/estimator'
import { getSupabase } from './supabase'

// =====================================================================
// Types aligned to the RPC jsonb returns (migration 0008 + applied 0003/0005).
// The server is authoritative (D8); these mirrors describe what PostgREST
// hands back for each RPC.
// =====================================================================

export type Outcome = 'decisive' | 'pyrrhic' | 'repelled' | 'crushed'
export type AttackStatus = 'inbound' | 'resolved'
export type NotificationKind =
  | 'under_attack'
  | 'invasion_landed'
  | 'planet_fell'
  | 'attack_result'
  | 'revenge'

export interface WalletRow {
  id: string
  display_name: string
  credits: number
  alloys: number
  last_seen_at: string
  created_at: string
}

export interface OwnedPlanetRow {
  id: number
  owner_id: string
  planet_name: string
  tier: number
  baseline_income_per_sec: number
  population_cap_multiplier: number
  distance_pc: number | null
  claimed_at: string
  is_home: boolean
  unconquerable: boolean
  massive_world: boolean
  dense_core: boolean
  population: number
  garrison: number
  fleet: number
  structure_levels: Record<string, number>
}

export interface AttackMemberRow {
  player_id: string
  soldiers_committed: number
  shipyard_tier: number
  joined_at: string
}

export interface AttackReport {
  attack_id: string
  target_planet_name: string
  launched_at: string
  resolved_at: string
  ratio: number
  outcome: Outcome
  combined_ap: number
  defense_power: number
  war_weariness_multiplier: number
  planet_taken: boolean
  winner_id: string | null
  members: Array<{
    player_id: string
    soldiers_committed: number
    shipyard_tier: number
    ap: number
    losses: number
  }>
  defender: {
    player_id: string
    population_before: number
    population_after: number
  }
}

export interface AttackRow {
  id: string
  target_planet_name: string
  launcher_id: string
  defender_id: string | null
  status: AttackStatus
  outcome: Outcome | null
  winner_id: string | null
  launched_at: string
  join_window_seconds: number
  travel_seconds: number
  resolves_at: string
  resolved_at: string | null
  attack_report: AttackReport | null
}

export interface NotificationRow {
  id: number
  player_id: string
  kind: NotificationKind
  payload: Record<string, unknown>
  created_at: string
  read_at: string | null
}

export interface PlayerStateResponse {
  player_id: string
  wallet: WalletRow | null
  owned_planets: OwnedPlanetRow[]
  attacks: AttackRow[]
  unread_notifications: NotificationRow[]
  resolved: AttackReport[]
}

export interface GalaxyInboundAttack {
  attack_id: string
  launcher_id: string
  resolves_at: string
}

export interface GalaxyPlanetRow {
  planet_name: string
  owner_id: string
  display_name: string
  tier: number
  population: number
  garrison: number
  fleet: number
  turret_level: number
  distance_pc: number | null
  massive_world: boolean
  unconquerable: boolean
  inbound_attacks: GalaxyInboundAttack[]
}

export interface GalaxyResponse {
  current_player_id: string
  planets: GalaxyPlanetRow[]
  my_weariness: number
  pvp: PvpConstants
  resolved: AttackReport[]
}

export interface AttackDetailResponse {
  found: boolean
  attack?: AttackRow
  members?: AttackMemberRow[]
  report?: AttackReport | null
}

export type LaunchAttackResult =
  | AttackRow
  | { launched: false; reason: string; join_attack_id: string }

export type ClaimResult =
  | OwnedPlanetRow
  | { claimed: false; reason: string }

export interface LaunchAttackArgs {
  targetPlanetName: string
  soldiers: number
  sourcePlanetName: string
}

export interface JoinAttackArgs {
  attackId: string
  soldiers: number
  sourcePlanetName: string
}

export interface ClaimPlanetArgs {
  planetName: string
  tier: number
  distancePc?: number | null
  massiveWorld?: boolean
  denseCore?: boolean
}

// =====================================================================
// RPC plumbing — server is authoritative; errors surface as thrown Error.
// =====================================================================

function requireClient(client: SupabaseClient | null | undefined): SupabaseClient {
  const resolved = client ?? getSupabase()
  if (resolved === null) {
    throw new Error(
      'Supabase not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY',
    )
  }
  return resolved
}

async function callRpc<T>(
  name: string,
  client: SupabaseClient | null | undefined,
  args?: Record<string, unknown>,
): Promise<T> {
  const sb = requireClient(client)
  const { data, error } = await sb.rpc(name, args ?? {})
  if (error !== null) {
    throw new Error(`${name}: ${error.message}`)
  }
  return data as T
}

// =====================================================================
// Read RPCs (0008) — each lazily resolves due attacks server-side.
// =====================================================================

export function getPlayerState(
  client?: SupabaseClient | null,
): Promise<PlayerStateResponse> {
  return callRpc<PlayerStateResponse>('get_player_state', client)
}

export function getGalaxy(client?: SupabaseClient | null): Promise<GalaxyResponse> {
  return callRpc<GalaxyResponse>('get_galaxy', client)
}

export function getAttack(
  attackId: string,
  client?: SupabaseClient | null,
): Promise<AttackDetailResponse> {
  return callRpc<AttackDetailResponse>('get_attack', client, { p_attack_id: attackId })
}

// =====================================================================
// Write RPCs (0003 / 0005, applied).
// =====================================================================

export function launchAttack(
  args: LaunchAttackArgs,
  client?: SupabaseClient | null,
): Promise<LaunchAttackResult> {
  return callRpc<LaunchAttackResult>('launch_attack', client, {
    p_target_planet_name: args.targetPlanetName,
    p_soldiers: args.soldiers,
    p_source_planet_name: args.sourcePlanetName,
  })
}

export function joinAttack(
  args: JoinAttackArgs,
  client?: SupabaseClient | null,
): Promise<AttackRow> {
  return callRpc<AttackRow>('join_attack', client, {
    p_attack_id: args.attackId,
    p_soldiers: args.soldiers,
    p_source_planet_name: args.sourcePlanetName,
  })
}

export function claimHomePlanet(
  args: ClaimPlanetArgs,
  client?: SupabaseClient | null,
): Promise<ClaimResult> {
  return callRpc<ClaimResult>('claim_home_planet', client, {
    p_planet_name: args.planetName,
    p_tier: args.tier,
    p_distance_pc: args.distancePc ?? null,
    p_massive_world: args.massiveWorld ?? false,
    p_dense_core: args.denseCore ?? false,
  })
}

export function claimColony(
  args: ClaimPlanetArgs,
  client?: SupabaseClient | null,
): Promise<ClaimResult> {
  return callRpc<ClaimResult>('claim_colony', client, {
    p_planet_name: args.planetName,
    p_tier: args.tier,
    p_distance_pc: args.distancePc ?? null,
    p_massive_world: args.massiveWorld ?? false,
    p_dense_core: args.denseCore ?? false,
  })
}
