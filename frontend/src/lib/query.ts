export function singleFlight<T>(request: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    if (pending) return pending;
    try {
      pending = request().finally(() => { pending = undefined; });
    } catch (error) {
      return Promise.reject(error);
    }
    return pending;
  };
}

export type QueryState = {
  status: "loading" | "ready" | "error" | "stale";
  updatedAt?: string;
  error?: string;
};

export function queryFailure(previous: QueryState, message: string): QueryState {
  return { ...previous, status: previous.updatedAt ? "stale" : "error", error: message };
}
