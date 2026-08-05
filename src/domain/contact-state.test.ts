// Unit tests for the pure Contact State domain (M7-A primary seam).
// Prior art: src/domain/post.test.ts, src/server/queue-domain.test.ts — pure
// functions, no DB. Covers every transition, the activation ratchet, decay,
// recovery, and score bounds.
import { describe, expect, it } from "vitest";
import {
  computeState,
  enteredChurned,
  opportunityBand,
  riskBand,
  stateConfig,
  DEFAULT_STATE_CONFIG,
  type StateSignals,
} from "./contact-state";

/** Signals for a fresh, never-activated contact interacting right now. */
function fresh(overrides: Partial<StateSignals> = {}): StateSignals {
  return {
    manualActivated: false,
    currentStage: "AWARE",
    touchesWindow: 0,
    conversationsWindow: 0,
    recentActiveMonths: 0,
    daysSinceLastInteraction: 0,
    volume365d: 0,
    ...overrides,
  };
}

describe("computeState — engagement baseline", () => {
  it("stays AWARE below the touch threshold", () => {
    expect(computeState(fresh({ touchesWindow: 2 })).stage).toBe("AWARE");
  });

  it("promotes to ENGAGED at ≥3 touches within the window", () => {
    expect(computeState(fresh({ touchesWindow: 3, currentStage: "AWARE" })).stage).toBe("ENGAGED");
  });

  it("promotes to ENGAGED on a single conversation within the window", () => {
    expect(computeState(fresh({ conversationsWindow: 1 })).stage).toBe("ENGAGED");
  });
});

describe("computeState — activation ratchet (grilling Q2)", () => {
  it("treats an activated contact as ACTIVATED even with zero recent engagement", () => {
    // An activated contact who simply hasn't clicked this week must NOT drop to
    // ENGAGED/AWARE via engagement recompute.
    const s = computeState(
      fresh({ manualActivated: true, touchesWindow: 0, conversationsWindow: 0, daysSinceLastInteraction: 1 }),
    );
    expect(s.stage).toBe("ACTIVATED");
  });

  it("still decays an activated contact to AT_RISK after the silence window", () => {
    // An activated Contact's persisted stage is ACTIVATED — silence decays it
    // to AT_RISK (the ratchet resists engagement-demotion, NOT risk decay).
    const s = computeState(
      fresh({
        manualActivated: true,
        currentStage: "ACTIVATED",
        daysSinceLastInteraction: DEFAULT_STATE_CONFIG.atRiskDays + 1,
      }),
    );
    expect(s.stage).toBe("AT_RISK");
  });

  it("still decays an activated AT_RISK contact to CHURNED after churnedDays", () => {
    const s = computeState(
      fresh({
        manualActivated: true,
        currentStage: "AT_RISK",
        daysSinceLastInteraction: DEFAULT_STATE_CONFIG.churnedDays + 1,
      }),
    );
    expect(s.stage).toBe("CHURNED");
  });
});

describe("computeState — LOYAL (grilling Q4 presence proxy)", () => {
  it("promotes ACTIVATED → LOYAL when all recent months are active", () => {
    const s = computeState(
      fresh({
        manualActivated: true,
        recentActiveMonths: DEFAULT_STATE_CONFIG.loyalMonths,
      }),
    );
    expect(s.stage).toBe("LOYAL");
  });

  it("does not reach LOYAL without activation (LOYAL only from ACTIVATED)", () => {
    const s = computeState(
      fresh({ manualActivated: false, recentActiveMonths: DEFAULT_STATE_CONFIG.loyalMonths, touchesWindow: 5 }),
    );
    expect(s.stage).toBe("ENGAGED");
  });

  it("LOYAL decays to AT_RISK after the silence window (not sticky)", () => {
    const s = computeState(
      fresh({
        manualActivated: true,
        currentStage: "LOYAL",
        recentActiveMonths: DEFAULT_STATE_CONFIG.loyalMonths,
        daysSinceLastInteraction: DEFAULT_STATE_CONFIG.atRiskDays + 1,
      }),
    );
    expect(s.stage).toBe("AT_RISK");
  });
});

describe("computeState — decay & recovery", () => {
  it("moves ENGAGED → AT_RISK after the silence window", () => {
    const s = computeState(
      fresh({ currentStage: "ENGAGED", daysSinceLastInteraction: DEFAULT_STATE_CONFIG.atRiskDays + 1 }),
    );
    expect(s.stage).toBe("AT_RISK");
  });

  it("moves AT_RISK → CHURNED after churnedDays without recovery", () => {
    const s = computeState(
      fresh({ currentStage: "AT_RISK", daysSinceLastInteraction: DEFAULT_STATE_CONFIG.churnedDays + 1 }),
    );
    expect(s.stage).toBe("CHURNED");
  });

  it("AWARE never decays below AWARE even after long silence", () => {
    const s = computeState(
      fresh({ currentStage: "AWARE", daysSinceLastInteraction: 999 }),
    );
    expect(s.stage).toBe("AWARE");
  });

  it("CHURNED recovery → AWARE (journey restart) when active again", () => {
    const s = computeState(
      fresh({
        currentStage: "CHURNED",
        daysSinceLastInteraction: 1,
        touchesWindow: 5, // even heavy recent activity restarts at AWARE
      }),
    );
    expect(s.stage).toBe("AWARE");
  });

  it("CHURNED with no recovery stays CHURNED", () => {
    const s = computeState(
      fresh({ currentStage: "CHURNED", daysSinceLastInteraction: DEFAULT_STATE_CONFIG.churnedDays + 50 }),
    );
    expect(s.stage).toBe("CHURNED");
  });

  it("AT_RISK recovery forward-recomputes (activated → ACTIVATED, not reset)", () => {
    const s = computeState(
      fresh({
        manualActivated: true,
        currentStage: "AT_RISK",
        daysSinceLastInteraction: 1,
        touchesWindow: 2,
      }),
    );
    expect(s.stage).toBe("ACTIVATED");
  });
});

describe("computeState — scoring bounds", () => {
  it("always returns scores in [0, 100]", () => {
    const cases: StateSignals[] = [
      fresh(),
      fresh({ manualActivated: true, currentStage: "CHURNED", daysSinceLastInteraction: 9999, volume365d: 9999 }),
      fresh({ touchesWindow: 100, conversationsWindow: 100, volume365d: 100 }),
    ];
    for (const s of cases) {
      const r = computeState(s);
      expect(r.riskScore).toBeGreaterThanOrEqual(0);
      expect(r.riskScore).toBeLessThanOrEqual(100);
      expect(r.opportunityScore).toBeGreaterThanOrEqual(0);
      expect(r.opportunityScore).toBeLessThanOrEqual(100);
    }
  });

  it("CHURNED has the highest risk and lowest opportunity", () => {
    const churned = computeState(
      fresh({ currentStage: "CHURNED", daysSinceLastInteraction: DEFAULT_STATE_CONFIG.churnedDays + 50 }),
    );
    const aware = computeState(fresh());
    expect(churned.riskScore).toBeGreaterThan(aware.riskScore);
    expect(churned.opportunityScore).toBeLessThan(aware.opportunityScore);
  });

  it("risk grows with silence", () => {
    const recent = computeState(fresh({ currentStage: "ENGAGED", daysSinceLastInteraction: 1 }));
    const silent = computeState(
      fresh({ currentStage: "ENGAGED", daysSinceLastInteraction: DEFAULT_STATE_CONFIG.atRiskDays - 1 }),
    );
    expect(silent.riskScore).toBeGreaterThanOrEqual(recent.riskScore);
  });
});

describe("enteredChurned", () => {
  it("is true only on a fresh transition into CHURNED", () => {
    expect(enteredChurned("AT_RISK", "CHURNED")).toBe(true);
    expect(enteredChurned("CHURNED", "CHURNED")).toBe(false);
    expect(enteredChurned("ENGAGED", "AT_RISK")).toBe(false);
  });
});

describe("bands (grilling Q3)", () => {
  it("maps risk scores to low/medium/high", () => {
    expect(riskBand(10)).toBe("low");
    expect(riskBand(50)).toBe("medium");
    expect(riskBand(85)).toBe("high");
  });

  it("maps opportunity scores to low/medium/high", () => {
    expect(opportunityBand(10)).toBe("low");
    expect(opportunityBand(45)).toBe("medium");
    expect(opportunityBand(80)).toBe("high");
  });
});

describe("stateConfig (env thresholds)", () => {
  it("falls back to defaults when env is unset", () => {
    const c = stateConfig({});
    expect(c).toEqual(DEFAULT_STATE_CONFIG);
  });

  it("reads overrides from env, ignoring non-integers", () => {
    const c = stateConfig({
      ENGAGE_THRESHOLD_TOUCHES: "5",
      AT_RISK_DAYS: "14",
      CHURNED_DAYS: "bogus", // ignored → default
    });
    expect(c.engageTouches).toBe(5);
    expect(c.atRiskDays).toBe(14);
    expect(c.churnedDays).toBe(DEFAULT_STATE_CONFIG.churnedDays);
  });
});
