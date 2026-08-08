interface OnboardingProps {
  step: number
  planetName: string
  onAdvance: () => void
  onSkip: () => void
}

const STEP_CONTENT: ReadonlyArray<{ title: string; body: (name: string) => string }> = [
  {
    title: 'Your planet',
    body: (name) =>
      `You now own ${name}. Build it up and check back while you are away.`,
  },
  {
    title: 'Grow your population',
    body: () => 'Build Housing to raise your population cap and start the idle loop.',
  },
  {
    title: 'Mine the ore',
    body: () => 'Build an Ore Mine to start producing alloys.',
  },
  {
    title: 'Offline earnings',
    body: () => 'Close the summary to collect what your planet earned while you were away.',
  },
]

export default function Onboarding({
  step,
  planetName,
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
      <p>{content.body(planetName)}</p>
      <div className="onboarding-actions">
        <button
          type="button"
          className="continue-button"
          aria-label="Continue"
          onClick={onAdvance}
        >
          Continue
        </button>
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
