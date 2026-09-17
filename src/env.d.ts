/// <reference types="astro/client" />

import type { Staff } from "./lib/auth";

declare global {
  namespace App {
    interface Locals {
      /* Set by src/middleware.ts on every guarded /admin request, so a page
         under the guard can rely on it and one that is not guarded cannot
         accidentally read a stale value. */
      staff?: Staff;
    }
  }
}

export {};
