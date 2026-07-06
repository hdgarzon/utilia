"use server";

import { cookies } from "next/headers";

const COOKIE_NAME = "selected_period";

export async function setSelectedPeriod(month: number, year: number): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, `${year}-${String(month).padStart(2, "0")}`, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 año
  });
}
