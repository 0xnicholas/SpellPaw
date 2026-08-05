// Contact State domain — pure functions, no I/O. The single source of truth
// for Lifecycle Stage transitions + Risk/Opportunity scoring (M7-A, ADR-0015).
//
// Mirrors the pure-domain pattern of src/domain/post.ts: the decision-rich
// logic lives here as a pure function of observable signals, so it is
// exhaustively unit-testable without a database. The DB-writing wrapper
// (src/server/interactions.ts) gathers the signals and persists the result.
//
// State machine (grilling-locked, ADR-0015):
// - Engagement baseline: AWARE → ENGAGED on ≥engageTouches Content Touches OR
//   ≥1 Conversation within engageWindowDays.
// - Activation ratchet: once activated (manual/event), engagement decay never
//   drops the stage back below ACTIVATED — but RISK decay can (→ AT_RISK →
//   CHURNED). "sticky" is a narrow guarantee, not immunity to churn.
// - LOYAL: only evaluated from ACTIVATED; requires interaction in each of the
//   last loyalMonths calendar months (Phase-1 "positive" proxy — no sentiment
//   field yet; sentiment correction loop arrives with Persona, M7-D).
// - AT_RISK: engageWindowDays (default 30) with no interaction.
// - CHURNED: AT_RISK sustained churnedDays (default 90) without recovery.
// - Recovery: AT_RISK → forward recompute; CHURNED → AWARE (journey restart).
//   Entering CHURNED clears the activation flag, so a recovered contact
//   progresses cleanly from AWARE rather than flickering back to ACTIVATED.

export type LifecycleStage =
  | "AWARE"
  | "ENGAGED"
  | "ACTIVATED"
  | "LOYAL"
  | "AT_RISK"
  | "CHURNED";

export type RiskBand = "low" | "medium" | "high";

/** Env-configurable thresholds (mirrors src/server/limits.ts planLimits). */
export interface StateConfig {
  engageTouches: number;
  engageWindowDays: number;
  loyalMonths: number;
  atRiskDays: number;
  churnedDays: number;
}

export const DEFAULT_STATE_CONFIG: StateConfig = {
  engageTouches: 3,
  engageWindowDays: 30,
  loyalMonths: 3,
  atRiskDays: 30,
  churnedDays: 90,
};

/** Resolve thresholds from env, falling back to documented defaults. */
export function stateConfig(
  env: Record<string, string | undefined> = process.env,
): StateConfig {
  const num = (v: string | undefined, fallback: number): number => {
    if (v === undefined || v === "") return fallback;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 ? n : fallback;
  };
  return {
    engageTouches: num(env.ENGAGE_THRESHOLD_TOUCHES, DEFAULT_STATE_CONFIG.engageTouches),
    engageWindowDays: num(env.ENGAGE_WINDOW_DAYS, DEFAULT_STATE_CONFIG.engageWindowDays),
    loyalMonths: num(env.LOYAL_MONTHS, DEFAULT_STATE_CONFIG.loyalMonths),
    atRiskDays: num(env.AT_RISK_DAYS, DEFAULT_STATE_CONFIG.atRiskDays),
    churnedDays: num(env.CHURNED_DAYS, DEFAULT_STATE_CONFIG.churnedDays),
  };
}

/** Observable Contact signals gathered by the wrapper. All plain data. */
export interface StateSignals {
  /** Ever activated (activatedAt set). Drives the ratchet; cleared on churn. */
  manualActivated: boolean;
  /** Current persisted stage — used to detect AT_RISK→CHURNED + CHURNED recovery. */
  currentStage: LifecycleStage;
  /** Content Touches within engageWindowDays. */
  touchesWindow: number;
  /** Conversations within engageWindowDays. */
  conversationsWindow: number;
  /** # of the last loyalMonths calendar months that each had ≥1 interaction. */
  recentActiveMonths: number;
  /** Days since the Contact's most recent Interaction (large/Infinity if none). */
  daysSinceLastInteraction: number;
  /** Total Interactions within 365d (drives the engagement-depth risk discount). */
  volume365d: number;
}

export interface ComputedState {
  stage: LifecycleStage;
  riskScore: number;
  opportunityScore: number;
}

// Score base tables (grilling Q3: transparent, deliberately uncalibrated).
const RISK_BASE: Record<LifecycleStage, number> = {
  AWARE: 20,
  ENGAGED: 15,
  ACTIVATED: 25,
  LOYAL: 10,
  AT_RISK: 80,
  CHURNED: 98,
};

const OPPORTUNITY_BASE: Record<LifecycleStage, number> = {
  AWARE: 5,
  ENGAGED: 25,
  ACTIVATED: 60,
  LOYAL: 80,
  AT_RISK: 10,
  CHURNED: 2,
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function riskScore(stage: LifecycleStage, daysSinceLast: number, volume365d: number): number {
  const silencePenalty = clamp((daysSinceLast / DEFAULT_STATE_CONFIG.churnedDays) * 60, 0, 60);
  const engagementDiscount = clamp((volume365d / 10) * 5, 0, 20);
  return clamp(Math.round(RISK_BASE[stage] + silencePenalty - engagementDiscount), 0, 100);
}

function opportunityScore(
  stage: LifecycleStage,
  daysSinceLast: number,
  windowVolume: number,
): number {
  const recencyBonus = clamp(
    ((DEFAULT_STATE_CONFIG.engageWindowDays - daysSinceLast) / DEFAULT_STATE_CONFIG.engageWindowDays) * 15,
    0,
    15,
  );
  const volumeBonus = clamp((windowVolume / 10) * 10, 0, 15);
  return clamp(Math.round(OPPORTUNITY_BASE[stage] + recencyBonus + volumeBonus), 0, 100);
}

function finalize(
  stage: LifecycleStage,
  daysSinceLast: number,
  volume365d: number,
  windowVolume: number,
): ComputedState {
  return {
    stage,
    riskScore: riskScore(stage, daysSinceLast, volume365d),
    opportunityScore: opportunityScore(stage, daysSinceLast, windowVolume),
  };
}

/**
 * Pure State computation. Deterministic function of observable signals +
 * current stage. See module header for the full transition rationale.
 */
export function computeState(signals: StateSignals, config = DEFAULT_STATE_CONFIG): ComputedState {
  const {
    manualActivated,
    currentStage,
    touchesWindow,
    conversationsWindow,
    recentActiveMonths,
    daysSinceLastInteraction,
    volume365d,
  } = signals;

  // CHURNED is terminal until the Contact is active again. Active again
  // (within the at-risk window) restarts the journey at AWARE (glossary);
  // still silent stays CHURNED.
  if (currentStage === "CHURNED") {
    const stage: LifecycleStage =
      daysSinceLastInteraction < config.atRiskDays ? "AWARE" : "CHURNED";
    return finalize(stage, daysSinceLastInteraction, volume365d, touchesWindow + conversationsWindow);
  }

  // Engagement baseline + activation ratchet.
  const engaged = touchesWindow >= config.engageTouches || conversationsWindow >= 1;
  let stage: LifecycleStage = manualActivated ? "ACTIVATED" : engaged ? "ENGAGED" : "AWARE";

  // Forward progression: ACTIVATED → LOYAL (only meaningful from ACTIVATED).
  if (stage === "ACTIVATED" && recentActiveMonths >= config.loyalMonths) {
    stage = "LOYAL";
  }

  // Risk decay (time-driven), gated on the PERSISTED stage so a formerly-
  // engaged Contact decays to AT_RISK rather than regressing to AWARE — but a
  // Contact that never left AWARE is not "at risk", it is just early.
  if (currentStage === "AT_RISK" && daysSinceLastInteraction >= config.churnedDays) {
    stage = "CHURNED";
  } else if (daysSinceLastInteraction >= config.atRiskDays && currentStage !== "AWARE") {
    stage = "AT_RISK";
  }

  return finalize(stage, daysSinceLastInteraction, volume365d, touchesWindow + conversationsWindow);
}

/** Did this recompute transition the Contact INTO CHURNED? (Wrapper clears
 *  activatedAt then — full journey-reset semantics, ADR-0015.) */
export function enteredChurned(from: LifecycleStage, next: LifecycleStage): boolean {
  return from !== "CHURNED" && next === "CHURNED";
}

// --- UI bands (grilling Q3: expose Low/Med/High in the UI, not raw 0–100) --

const RISK_BAND_THRESHOLDS = { medium: 40, high: 70 } as const;
const OPPORTUNITY_BAND_THRESHOLDS = { medium: 30, high: 60 } as const;

export function riskBand(score: number): RiskBand {
  if (score >= RISK_BAND_THRESHOLDS.high) return "high";
  if (score >= RISK_BAND_THRESHOLDS.medium) return "medium";
  return "low";
}

export function opportunityBand(score: number): RiskBand {
  if (score >= OPPORTUNITY_BAND_THRESHOLDS.high) return "high";
  if (score >= OPPORTUNITY_BAND_THRESHOLDS.medium) return "medium";
  return "low";
}
