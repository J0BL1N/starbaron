import { formatNumber } from '../../sim/core/format'
import { wearinessLaunchCount } from '../../sim/player/estimator'

// =====================================================================
// War weariness surface (P3-T05-B, audit §2.2 / B7). Renders the player's
// CURRENT war-weariness stack — get_galaxy.my_weariness = 1.2^n for the
// caller's prior in-window launches — so a player can see "your 3rd conquest
// this window costs 1.728x" BEFORE scouting/launching, plus each member's
// own stack from the get_attack roster (per-member weariness drags the
// combined AP down, 0011 B2/G3). Presentational: the caller passes the
// server data (myWeariness from get_galaxy, members from get_attack); the
// sim client is local-first so it defaults to a fresh stack (1.0x, 0 prior).
// =====================================================================

export interface WarRosterMember {
  playerId: string
  soldiersCommitted: number
  weariness: number
}

interface WarWearinessPanelProps {
  myWeariness?: number
  members?: WarRosterMember[]
}

export default function WarWearinessPanel({
  myWeariness = 1,
  members = [],
}: WarWearinessPanelProps) {
  const prior = wearinessLaunchCount(myWeariness)
  const next = prior + 1
  return (
    <section className="war-weariness-panel" aria-label="War weariness">
      <h2>War Weariness</h2>
      <p data-testid="my-weariness">
        {prior === 0
          ? 'No launches this 24h window — your next conquest fights at full strength (1.0x).'
          : `Your ${next}th conquest this 24h window faces ${myWeariness.toFixed(
              3,
            )}x required strength (${prior} prior launch${prior === 1 ? '' : 'es'}).`}
      </p>
      {members.length > 0 ? (
        <ul className="war-weariness-roster">
          {members.map((member) => (
            <li
              key={member.playerId}
              data-testid={`member-weariness-${member.playerId}`}
            >
              {member.playerId} — {formatNumber(member.soldiersCommitted)}{' '}
              committed · {member.weariness.toFixed(3)}x weariness
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
