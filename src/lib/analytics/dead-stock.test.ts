import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { computeGoalPace } from "./dead-stock";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("computeGoalPace", () => {
  const base = {
    goalAmount: 6_000_000,
    baseline: 20_000_000,
    setOn: day("2026-10-01"),
    deadline: day("2026-12-31"),
  };

  it("mide el avance como caida del capital muerto desde la linea base", () => {
    const p = computeGoalPace({ ...base, currentDeadStock: 18_000_000, today: day("2026-10-29") });
    expect(p.progress).toBe(2_000_000);
    expect(p.remaining).toBe(4_000_000);
    expect(p.daysElapsed).toBe(28);
    expect(p.daysLeft).toBe(63);
    expect(p.actualPerWeek).toBeCloseTo(500_000);
    expect(p.requiredPerWeek).toBeCloseTo((4_000_000 / 63) * 7);
    expect(p.status).toBe("on_track");
  });

  it("marca atrasada cuando el ritmo real no alcanza", () => {
    const p = computeGoalPace({ ...base, currentDeadStock: 19_500_000, today: day("2026-10-29") });
    expect(p.status).toBe("behind");
  });

  it("si el capital muerto sube no cuenta como avance negativo", () => {
    const p = computeGoalPace({ ...base, currentDeadStock: 22_000_000, today: day("2026-10-29") });
    expect(p.progress).toBe(0);
    expect(p.remaining).toBe(6_000_000);
  });

  it("la primera semana no juzga el ritmo", () => {
    const p = computeGoalPace({ ...base, currentDeadStock: 20_000_000, today: day("2026-10-04") });
    expect(p.status).toBe("on_track");
  });

  it("cumplida y vencida", () => {
    expect(computeGoalPace({ ...base, currentDeadStock: 13_000_000, today: day("2027-01-10") }).status).toBe("met");
    const vencida = computeGoalPace({ ...base, currentDeadStock: 19_000_000, today: day("2027-01-10") });
    expect(vencida.status).toBe("overdue");
    expect(vencida.daysLeft).toBe(-10);
  });
});
