/**
 * Branded source-of-construction capability for real catalogue data.
 *
 * A world record is only ever labelled realData: true when the construction
 * path holds the opaque CATALOGUE_TRUST token. The token is a unique symbol
 * (Symbol.for is NOT used), so it cannot be forged by string comparison or a
 * global symbol registry lookup — the interface requires an object carrying
 * the exact symbol key with value true. Only ./catalogue (the pinned NASA
 * Exoplanet Archive mapping) creates the token; every other path — procedural
 * construction, render code, ad-hoc callers — goes through the factories
 * without it and receives the procedural defaults (realData false, provenance
 * 'procedural'). The factories throw when realData: true is attempted without
 * the capability (see assertTrustedRealData in ./galaxy).
 */

export const CATALOGUE_TRUST = Symbol('catalogueTrust')

export interface CatalogueTrust {
  [CATALOGUE_TRUST]: true
}
