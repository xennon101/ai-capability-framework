import type { ProviderInvocation } from "./provider-types.js";
export function stopReason(request: Pick<ProviderInvocation, "signal" | "deadlineAt">): "cancelled" | "deadline_exceeded" | undefined {
  if (request.signal?.aborted) return "cancelled";
  if (request.deadlineAt !== undefined && Date.now() >= request.deadlineAt) return "deadline_exceeded";
  return undefined;
}

export function stopGate(request: ProviderInvocation & { deadlineAt: number }, controller: AbortController) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolve!: (value: "cancelled" | "deadline_exceeded") => void;
  const promise = new Promise<"cancelled" | "deadline_exceeded">(done => { resolve = done; });
  const abort = () => { controller.abort(); resolve("cancelled"); };
  const tick = () => {
    const remaining = request.deadlineAt - Date.now();
    if (remaining <= 0) { controller.abort(); resolve("deadline_exceeded"); }
    else timer = setTimeout(tick, Math.min(remaining, 2_147_483_647));
  };
  request.signal?.addEventListener("abort", abort, { once: true });
  if (request.signal?.aborted) abort();
  tick();
  return { promise, dispose: () => { if (timer) clearTimeout(timer); request.signal?.removeEventListener("abort", abort); } };
}

