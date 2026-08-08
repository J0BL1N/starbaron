import { formatNumber } from '../../sim/core/format'

interface ColonisePanelProps {
  canColonise: boolean
  busy: boolean
  error: string | null
  cost: number
  onColonise: () => void
}

export default function ColonisePanel({
  canColonise,
  busy,
  error,
  cost,
  onColonise,
}: ColonisePanelProps) {
  if (!canColonise) {
    return (
      <section className="colonise-panel" aria-label="Colonise">
        <p className="colonise-note">Every planet in the catalogue is claimed.</p>
      </section>
    )
  }
  return (
    <section className="colonise-panel" aria-label="Colonise">
      <div className="colonise-row">
        <span className="colonise-name">Expand your empire</span>
        <span className="colonise-cost mono">{formatNumber(cost)} cr</span>
        <button
          type="button"
          className="colonise-button"
          disabled={busy}
          aria-label="Colonise"
          onClick={onColonise}
        >
          {busy ? 'COLONISING' : 'COLONISE'}
        </button>
      </div>
      {error ? (
        <p className="colonise-error" role="status">
          {error}
        </p>
      ) : null}
    </section>
  )
}
