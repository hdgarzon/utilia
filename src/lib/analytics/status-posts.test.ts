import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@ai-sdk/openai", () => ({ openai: vi.fn() }));
vi.mock("ai", () => ({ generateObject: vi.fn() }));

import { discountForRotation } from "./status-posts";

describe("discountForRotation", () => {
  it("escalera 20 / 30 / 40 segun los dias sin venta", () => {
    expect(discountForRotation(31)).toBe(20);
    expect(discountForRotation(60)).toBe(20);
    expect(discountForRotation(61)).toBe(30);
    expect(discountForRotation(90)).toBe(30);
    expect(discountForRotation(91)).toBe(40);
    expect(discountForRotation(400)).toBe(40);
  });
});
