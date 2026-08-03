import { describe, expect, it } from "vitest";
import {
  CRON_HORIZON_MS,
  publishJobId,
  publishQueueName,
  scheduleDelayMs,
  schedulerJobId,
  shouldUseCron,
} from "./queue-domain";

const NOW = new Date("2026-08-03T10:00:00Z");

describe("scheduleDelayMs", () => {
  it("returns the full delay for a future schedule", () => {
    const later = new Date("2026-08-03T10:00:30Z");
    expect(scheduleDelayMs(later, NOW)).toBe(30_000);
  });

  it("clamps overdue schedules to zero (publish immediately)", () => {
    const past = new Date("2026-08-03T09:00:00Z");
    expect(scheduleDelayMs(past, NOW)).toBe(0);
  });
});

describe("shouldUseCron", () => {
  it("uses BullMQ delay for schedules within the 7-day horizon", () => {
    const in6d = new Date(NOW.getTime() + 6 * CRON_HORIZON_MS / 7);
    expect(shouldUseCron(in6d, NOW)).toBe(false);
  });

  it("uses the cron reconciler beyond the 7-day horizon (spec: > 7 days)", () => {
    const in8d = new Date(NOW.getTime() + 8 * 86_400_000);
    expect(shouldUseCron(in8d, NOW)).toBe(true);
  });

  it("uses the delay path exactly at the horizon boundary (spec: ≤ 7 days)", () => {
    const atHorizon = new Date(NOW.getTime() + CRON_HORIZON_MS);
    expect(shouldUseCron(atHorizon, NOW)).toBe(false);
  });
});

describe("job ids and queue names", () => {
  it("builds stable, namespaced job ids", () => {
    expect(publishJobId("v1")).toBe("publish-v1");
    expect(schedulerJobId("p1")).toBe("schedule-p1");
  });

  it("names publish queues per channel for worker isolation", () => {
    expect(publishQueueName("twitter")).toBe("publish-twitter");
    expect(publishQueueName("linkedin")).toBe("publish-linkedin");
  });
});
