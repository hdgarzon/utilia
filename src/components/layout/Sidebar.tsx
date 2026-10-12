"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { BrandMark } from "./nav-config";
import { NavLinks } from "./NavLinks";

export function Sidebar() {
  return (
    <aside className="hidden md:flex h-screen w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 items-center px-6">
        <BrandMark />
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <NavLinks />
      </nav>

      <div className="p-3">
        <SignOutButton />
      </div>
    </aside>
  );
}

export function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
    >
      <LogOut className="h-4 w-4 shrink-0 text-muted-foreground" />
      Cerrar sesión
    </button>
  );
}
