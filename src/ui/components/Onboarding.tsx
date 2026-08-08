interface OnboardingProps {
  step: number
  onAdvance: () => void
  onSkip: () => void
}

const STEP_CONTENT: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'Welcome, Commander',
    body: 'This is your home planet, Gliese 667 Cc. Build it up and check back while you are away.',
  },
  {
    title: 'Grow your population',
    body: 'Build Housing to raise your population cap and start the idle loop.',
  },
  {
    title: 'Mine the ore',
    body: 'Build an Ore Mine to start producing alloys.',
  },
  {
    title: 'Offline earnings',
    body: 'Close the summary to collect what your planet earned while you were away.',
  },
]

export default function Onboarding({
  step,
  onAdvance,
  onSkip,
}: OnboardingProps) {
  const content = STEP_CONTENT[step] ?? STEP_CONTENT[0]
  return (
    <aside
      className="onboarding-card"
      role="region"
      aria-label="Tutorial"
      data-step={step}
    >
      <h3>{content.title}</h3>
      <p>{content.body}</p>
      <div className="onboarding-actions">
        {step === 0 ? (
          <button
            type="button"
            className="claim-button"
            aria-label="Claim your planet"
            onClick={onAdvance}
          >
            Claim
          </button>
        ) : null}
        <button
          type="button"
          className="skip-button"
          aria-label="Skip tutorial"
          onClick={onSkip}
        >
          Skip
        </button>
      </div>
    </aside>
  )
}
