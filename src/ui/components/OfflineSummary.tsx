import { formatNumber } from '../../sim/core/format'
import type { OfflineGain } from '../useGameState'

interface OfflineSummaryProps {
  gain: OfflineGain
  onClose: () => void
}

function formatElapsed(totalSec: number): string {
  const hours = Math.floor(totalSec / 3_600)
  const minutes = Math.floor((totalSec % 3_600) / 60)
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  }
  return `${minutes}m`
}

interface GainRowProps {
  label: string
  value: number
}

function GainRow({ label, value }: GainRowProps) {
  if (value <= 0) {
    return null
  }
  return (
    <li>
      <span>{label}</span>
      <span className="mono">+{formatNumber(value)}</span>
    </li>
  )
}

export default function OfflineSummary({ gain, onClose }: OfflineSummaryProps) {
  return (
    <div className="modal-backdrop">
      <section
        className="offline-summary"
        role="dialog"
        aria-modal="true"
        aria-labelledby="offline-title"
      >
        <h2 id="offline-title">While you were away…</h2>
        <p className="offline-elapsed mono">{formatElapsed(gain.elapsedSec)}</p>
        <ul className="offline-gains">
          <GainRow label="Credits" value={gain.credits} />
          <GainRow label="Alloys" value={gain.alloys} />
          <GainRow label="Population" value={gain.population} />
          <GainRow label="Garrison" value={gain.garrison} />
          <GainRow label="Fleet" value={gain.fleet} />
        </ul>
        <button
          type="button"
          aria-label="Close offline summary"
          onClick={onClose}
        >
          Claim
        </button>
      </section>
    </div>
  )
}
