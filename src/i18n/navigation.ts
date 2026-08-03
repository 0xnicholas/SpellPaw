import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// Locale-aware Link / redirect / usePathname / useRouter (spec §7 path prefix).
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
