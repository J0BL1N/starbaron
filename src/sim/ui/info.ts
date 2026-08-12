/**
 * Object information contracts (P4-T03).
 *
 * The CONTRACT layer for object visibility: which information exists about a
 * galaxy / system / body, at which visibility level it sits, and how a
 * viewer's level projects onto a display-ready field list. Backend
 * enforcement (P6) is OUT OF SCOPE here — this module defines the contract
 * and a pure projection function the UI can render; P6 maps InfoLevel onto
 * backend permission checks.
 *
 * PURE module: every function derives only from its arguments — no
 * nondeterministic APIs, no module-level mutable state, no wall-clock, no
 * I/O. The same inputs always produce the same (deep-equal) output.
 *
 * LEVEL SEMANTICS — cumulative visibility tiers (locked by the roadmap):
 *   - public   — anyone, no relationship (name/id/type/class + spatial facts)
 *   - owner    — the player who owns the object (population/structures/income)
 *   - alliance — the owner's alliance members (alliance-held flags)
 *   - intel    — scouted intelligence (fleet/defense details; DESIGN §5
 *                full-info scouting — attackers see defenses + estimated odds)
 * A field is projected when its level rank <= the viewer's level rank, so an
 * intel viewer sees everything below intel too.
 *
 * HIDDEN-TRUTH RULE (mirrors the roadmap's 'never send unauthorized hidden
 * truth'): fields above the viewer's level are EXCLUDED — never emitted as a
 * placeholder or a null stand-in, so the client never sees hidden truth.
 *
 * STATES: a field's InfoField.state inside a CONTRACT carries its BASE state
 * qualifier (intel fields are intrinsically 'estimated' — scouting data is an
 * estimate). projectInfo recomputes the viewer-facing state:
 *   - missing value or value null   → 'unknown', value null
 *   - value present, staleness true → 'stale'
 *   - value present, not stale      → 'verified'
 * 'estimated' is the base qualifier only; the projection never emits it —
 * the contract layer cannot know whether a value is an estimate, that is the
 * backend's (P6) job.
 *
 * NUMBER FORMATTING: numeric values on 'number' fields go through the locked
 * formatNumber (../core/format) — no environment-dependent formatting APIs,
 * byte-identical repeats.
 * String values pass through untouched; numeric values on 'text' fields fall
 * back to String(value).
 */

import { formatNumber } from '../core/format'

export type InfoKind = 'galaxy' | 'system' | 'body'

export const INFO_KINDS: readonly InfoKind[] = ['galaxy', 'system', 'body']

export type InfoLevel = 'public' | 'owner' | 'alliance' | 'intel'

export const INFO_LEVELS: readonly InfoLevel[] = [
  'public',
  'owner',
  'alliance',
  'intel',
]

export type InfoState = 'unknown' | 'estimated' | 'stale' | 'verified'

export type InfoFormat = 'number' | 'text'

export interface InfoField {
  key: string
  label: string
  value: string | null
  level: InfoLevel
  state: InfoState
  format?: InfoFormat
}

/** Per-object display schema: which projected fields drive the header UI. */
export interface DisplaySchema {
  titleKey: string
  subtitleKey: string
  primaryStatKey: string
}

export interface ObjectInfoContract {
  kind: InfoKind
  type?: string
  fields: InfoField[]
  displaySchema: DisplaySchema
}

export interface ProjectInfoInput {
  contract: ObjectInfoContract
  values: ReadonlyMap<string, string | number | null>
  viewerLevel: InfoLevel
  staleness: ReadonlyMap<string, boolean>
}

const LEVEL_RANK: Readonly<Record<InfoLevel, number>> = {
  public: 0,
  owner: 1,
  alliance: 2,
  intel: 3,
}

/** Module-wide title convention: every contract's titleKey is 'name'. */
const TITLE_KEY = 'name'

/** Per-kind primary stat keys — unique across kinds, so summaryLine can
 * recover the display schema's primaryStatKey from a projected field list. */
const PRIMARY_STAT_KEY_BY_KIND: Readonly<Record<InfoKind, string>> = {
  galaxy: 'systemCount',
  system: 'bodyCount',
  body: 'population',
}

function baseField(
  key: string,
  label: string,
  level: InfoLevel,
  format: InfoFormat,
  state: InfoState = 'verified',
): InfoField {
  return { key, label, value: null, level, state, format }
}

const GALAXY_FIELDS: readonly InfoField[] = [
  baseField('name', 'Name', 'public', 'text'),
  baseField('id', 'ID', 'public', 'text'),
  baseField('class', 'Class', 'public', 'text'),
  baseField('radius', 'Radius', 'public', 'number'),
  baseField('systemCount', 'Systems', 'public', 'number'),
  baseField('ownedBodies', 'Owned bodies', 'owner', 'number'),
  baseField('allianceBodies', 'Alliance bodies', 'alliance', 'number'),
  baseField('foreignFleet', 'Foreign fleet', 'intel', 'number', 'estimated'),
]

const SYSTEM_FIELDS: readonly InfoField[] = [
  baseField('name', 'Name', 'public', 'text'),
  baseField('id', 'ID', 'public', 'text'),
  baseField('type', 'Star type', 'public', 'text'),
  baseField('bodyCount', 'Bodies', 'public', 'number'),
  baseField('ownedBodies', 'Owned bodies', 'owner', 'number'),
  baseField('allianceHeld', 'Alliance held', 'alliance', 'text'),
  baseField('defensePower', 'Defense power', 'intel', 'number', 'estimated'),
  baseField('fleetStrength', 'Fleet strength', 'intel', 'number', 'estimated'),
]

const BODY_FIELDS: readonly InfoField[] = [
  baseField('name', 'Name', 'public', 'text'),
  baseField('id', 'ID', 'public', 'text'),
  baseField('type', 'Type', 'public', 'text'),
  baseField('class', 'Class', 'public', 'text'),
  baseField('radius', 'Radius', 'public', 'number'),
  baseField('population', 'Population', 'owner', 'number'),
  baseField('structures', 'Structures', 'owner', 'number'),
  baseField('income', 'Income', 'owner', 'number'),
  baseField('allianceHeld', 'Alliance held', 'alliance', 'text'),
  baseField('garrison', 'Garrison', 'intel', 'number', 'estimated'),
  baseField('defensePower', 'Defense power', 'intel', 'number', 'estimated'),
  baseField('fleetStrength', 'Fleet strength', 'intel', 'number', 'estimated'),
  baseField('estimatedOdds', 'Estimated odds', 'intel', 'text', 'estimated'),
]

const FIELD_DEFS: Readonly<Record<InfoKind, readonly InfoField[]>> = {
  galaxy: GALAXY_FIELDS,
  system: SYSTEM_FIELDS,
  body: BODY_FIELDS,
}

const DISPLAY_SCHEMAS: Readonly<Record<InfoKind, DisplaySchema>> = {
  galaxy: { titleKey: 'name', subtitleKey: 'class', primaryStatKey: 'systemCount' },
  system: { titleKey: 'name', subtitleKey: 'type', primaryStatKey: 'bodyCount' },
  body: { titleKey: 'name', subtitleKey: 'type', primaryStatKey: 'population' },
}

function assertNonEmpty(value: string, name: string): string {
  const trimmed = value.trim()
  if (trimmed === '') {
    throw new RangeError(
      `${name} must be a non-empty string, got ${JSON.stringify(value)}`,
    )
  }
  return trimmed
}

function isInfoLevel(value: unknown): value is InfoLevel {
  return (INFO_LEVELS as readonly string[]).includes(value as string)
}

/**
 * The per-object display schema: which fields exist, their base visibility
 * level, and the title/subtitle/primary-stat keys for the header UI.
 * Deterministic — same (kind, type) always yields a deep-equal contract, and
 * every call returns a fresh object so callers can never mutate shared state.
 * Every field key is unique within a contract.
 *
 * Validation: `kind` must be one of galaxy/system/body; a galaxy takes no
 * type discriminator (its class is the public 'class' field); a system or
 * body type is an arbitrary non-empty string when given (carried into
 * contract.type).
 */
export function contractFor(kind: InfoKind, type?: string): ObjectInfoContract {
  if (kind !== 'galaxy' && kind !== 'system' && kind !== 'body') {
    throw new RangeError(
      `contractFor: invalid kind ${JSON.stringify(kind)}, expected one of ${INFO_KINDS.join(', ')}`,
    )
  }

  let contractType: string | undefined
  if (kind === 'galaxy') {
    if (type !== undefined) {
      throw new RangeError(
        `contractFor: a galaxy contract has no type discriminator, got ${JSON.stringify(type)}`,
      )
    }
  } else {
    const trimmed = type === undefined ? undefined : assertNonEmpty(type, 'type')
    contractType = trimmed
  }

  return {
    kind,
    ...(contractType === undefined ? {} : { type: contractType }),
    fields: FIELD_DEFS[kind].map((field) => ({ ...field })),
    displaySchema: { ...DISPLAY_SCHEMAS[kind] },
  }
}

/**
 * The PURE PROJECTION: the viewer-facing field list for a contract.
 * A field is included when its level rank <= the viewer's level rank;
 * otherwise it is EXCLUDED entirely — never a placeholder, never a null
 * stand-in (hidden truth is never sent). Included fields take their value
 * from the values map and their state from staleness:
 *   - value present and non-null: state 'stale' when staleness flags the key,
 *     else 'verified';
 *   - value null or missing from the map: state 'unknown', value null.
 * Numeric values on 'number' fields pass through the locked formatNumber.
 * The output preserves the contract's field order; inputs are never mutated.
 */
export function projectInfo(input: ProjectInfoInput): InfoField[] {
  if (!isInfoLevel(input.viewerLevel)) {
    throw new RangeError(
      `projectInfo: invalid viewerLevel ${JSON.stringify(input.viewerLevel)}, expected one of ${INFO_LEVELS.join(', ')}`,
    )
  }
  const viewerRank = LEVEL_RANK[input.viewerLevel]
  const result: InfoField[] = []
  for (const field of input.contract.fields) {
    if (LEVEL_RANK[field.level] > viewerRank) {
      continue
    }
    const raw = input.values.get(field.key)
    let value: string | null
    if (raw === undefined || raw === null) {
      value = null
    } else if (typeof raw === 'number') {
      value = field.format === 'number' ? formatNumber(raw) : String(raw)
    } else {
      value = raw
    }
    const state: InfoState =
      value === null
        ? 'unknown'
        : input.staleness.get(field.key) === true
          ? 'stale'
          : 'verified'
    result.push({
      key: field.key,
      label: field.label,
      value,
      level: field.level,
      state,
      ...(field.format === undefined ? {} : { format: field.format }),
    })
  }
  return result
}

/**
 * Recover the display schema's primary stat field from a projected field
 * list. The per-kind primary stat keys are unique across kinds, so the key is
 * inferred from which one is present: population (body) → bodyCount (system)
 * → systemCount (galaxy) → none.
 */
function primaryStatFor(fields: readonly InfoField[]): InfoField | undefined {
  for (const key of [
    PRIMARY_STAT_KEY_BY_KIND.body,
    PRIMARY_STAT_KEY_BY_KIND.system,
    PRIMARY_STAT_KEY_BY_KIND.galaxy,
  ]) {
    const field = fields.find((candidate) => candidate.key === key)
    if (field !== undefined) {
      return field
    }
  }
  return undefined
}

/**
 * Deterministic one-line summary of the VISIBLE fields: the title (the
 * contract's titleKey field — 'name' for every contract) followed by the
 * primary stat value, joined with ' · '. Only visible fields are used — when
 * the primary stat is hidden (or its value unknown) it is omitted; with
 * nothing visible the summary is the empty string.
 */
export function summaryLine(fields: readonly InfoField[]): string {
  const title = fields.find((field) => field.key === TITLE_KEY) ?? fields[0]
  const primary = primaryStatFor(fields)
  const parts: string[] = []
  if (title !== undefined && title.value !== null) {
    parts.push(title.value)
  }
  if (primary !== undefined && primary.value !== null) {
    parts.push(primary.value)
  }
  return parts.join(' · ')
}
