import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useResource } from "./useResource";

const get = vi.fn();
vi.mock("@essentials/api-client", () => ({ api: { get: (...args: unknown[]) => get(...args) } }));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useResource", () => {
  beforeEach(() => get.mockReset());
  afterEach(() => vi.clearAllMocks());

  it("stays loading until the first answer lands, then stops", async () => {
    get.mockResolvedValue([1, 2]);
    const { result } = renderHook(() => useResource<number[]>("/things"));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([1, 2]);
    expect(result.current.error).toBeNull();
  });

  it("does nothing at all for a null path, and asks again when it appears", async () => {
    get.mockResolvedValue({ id: "x" });
    const { result, rerender } = renderHook(({ path }) => useResource<{ id: string }>(path), {
      initialProps: { path: null as string | null },
    });

    expect(get).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);

    rerender({ path: "/thing" });
    await waitFor(() => expect(result.current.data).toEqual({ id: "x" }));
    expect(get).toHaveBeenCalledWith("/thing", expect.objectContaining({ cache: "no-store" }));
  });

  it("aborts the request when the path changes or the component unmounts", async () => {
    const first = deferred<string[]>();
    get.mockReturnValueOnce(first.promise).mockResolvedValue([".next"]);
    const { result, rerender, unmount } = renderHook(({ path }) => useResource<string[]>(path), {
      initialProps: { path: "/first" },
    });

    const signal = get.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    rerender({ path: "/second" });
    expect(signal.aborted).toBe(true);
    await waitFor(() => expect(result.current.data).toEqual([".next"]));

    const secondSignal = get.mock.calls[1][1].signal as AbortSignal;
    unmount();
    expect(secondSignal.aborted).toBe(true);
  });

  it("ignores a slow earlier response that lands after a newer one", async () => {
    const slow = deferred<string[]>();
    get.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(["new"]);

    const { result, rerender } = renderHook(({ path }) => useResource<string[]>(path), {
      initialProps: { path: "/slow" },
    });
    rerender({ path: "/fast" });

    await waitFor(() => expect(result.current.data).toEqual(["new"]));

    // The abandoned request finishes last and must not overwrite the newer page.
    await act(async () => {
      slow.resolve(["stale"]);
      await slow.promise;
    });
    expect(result.current.data).toEqual(["new"]);
  });

  it("drops data from the previous path instead of showing it under a new one", async () => {
    get.mockResolvedValueOnce([1]).mockReturnValueOnce(deferred<number[]>().promise);
    const { result, rerender } = renderHook(({ path }) => useResource<number[]>(path), {
      initialProps: { path: "/one" },
    });
    await waitFor(() => expect(result.current.data).toEqual([1]));

    rerender({ path: "/two" });
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  it("keeps the last data visible while a reload is in flight", async () => {
    get.mockResolvedValueOnce(["kept"]).mockReturnValueOnce(deferred<string[]>().promise);
    const { result } = renderHook(() => useResource<string[]>("/list"));
    await waitFor(() => expect(result.current.data).toEqual(["kept"]));

    act(() => result.current.reload());

    expect(result.current.data).toEqual(["kept"]);
    expect(result.current.loading).toBe(false);
  });

  it("reports the API message on failure and clears it on the next success", async () => {
    get.mockRejectedValueOnce(new Error("Nope")).mockResolvedValueOnce(["ok"]);
    const { result } = renderHook(() => useResource<string[]>("/list"));

    await waitFor(() => expect(result.current.error).toBe("Nope"));
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();

    act(() => result.current.reload());
    await waitFor(() => expect(result.current.data).toEqual(["ok"]));
    expect(result.current.error).toBeNull();
  });

  it("accepts updater functions through setData, like useState", async () => {
    get.mockResolvedValue([1, 2]);
    const { result } = renderHook(() => useResource<number[]>("/list"));
    await waitFor(() => expect(result.current.data).toEqual([1, 2]));

    act(() => result.current.setData((prev) => [...(prev ?? []), 3]));
    expect(result.current.data).toEqual([1, 2, 3]);
  });
});
