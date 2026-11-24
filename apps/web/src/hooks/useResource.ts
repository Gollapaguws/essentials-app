"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { api } from "@essentials/api-client";
import { errorMessage } from "@/lib/errors";

export interface Resource<T> {
  /** Null until the first successful load (or when `path` is null). */
  data: T | null;
  error: string | null;
  /** True only until the first answer lands, so a reload never blanks the screen. */
  loading: boolean;
  reload: () => void;
  /** For optimistic updates and edits that patch the list in place. */
  setData: Dispatch<SetStateAction<T | null>>;
}

interface State<T> {
  data: T | null;
  error: string | null;
  settled: boolean;
}

/**
 * One GET, with the states every dashboard screen needs.
 *
 * Every page used to hand-roll the same `useEffect` + `useState` + try/catch, which
 * meant each one forgot a different part: abort on unmount, a stale request
 * overwriting a fresh one, or the spinner never clearing. Pass `null` to stay idle
 * (for a path that depends on a role that has not loaded yet).
 */
export function useResource<T>(path: string | null): Resource<T> {
  const [state, setState] = useState<State<T>>({
    data: null,
    error: null,
    settled: path === null,
  });
  const [nonce, setNonce] = useState(0);
  // Guards against a slower earlier request landing after a newer one.
  const latest = useRef(0);

  // A new path is a new resource: stale rows from the previous query must not show
  // under the new one.
  useEffect(() => {
    setState({ data: null, error: null, settled: path === null });
  }, [path]);

  useEffect(() => {
    if (!path) return;
    const request = ++latest.current;
    const controller = new AbortController();

    api
      .get<T>(path, { cache: "no-store", signal: controller.signal })
      .then((data) => {
        if (request === latest.current) setState({ data, error: null, settled: true });
      })
      .catch((e) => {
        if (controller.signal.aborted || request !== latest.current) return;
        setState((prev) => ({ ...prev, error: errorMessage(e), settled: true }));
      });

    return () => controller.abort();
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return {
    data: state.data,
    error: state.error,
    loading: !state.settled,
    reload,
    setData: (next) =>
      setState((prev) => ({
        // Same contract as useState: accept a value or an updater.
        data: typeof next === "function" ? (next as (old: T | null) => T | null)(prev.data) : next,
        error: prev.error,
        settled: true,
      })),
  };
}
