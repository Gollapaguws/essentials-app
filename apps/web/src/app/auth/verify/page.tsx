"use client";

import { Suspense } from "react";
import AuthVerifyInner from "./verify-inner";

export default function AuthVerify() {
  return (
    <Suspense fallback={
      <main className="min-h-screen grid place-items-center px-6">
        <p className="text-neutral-400">VERIFYING…</p>
      </main>
    }>
      <AuthVerifyInner />
    </Suspense>
  );
}
