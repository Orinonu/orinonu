const admissions = new Map<string, Record<string, unknown>>();
class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function api<T = unknown>(
  path: string,
  method = "GET",
  body?: unknown,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 20000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const response = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    let message = "Operação indisponível.";
    try {
      message = (await response.json()).error ?? message;
    } catch {}
    throw new HttpError(message, response.status);
  }
  try {
    return await response.json();
  } catch {
    throw new Error("Resposta do servidor incompatível: JSON válido não recebido.");
  }
}
export async function admit(
  path: string,
  body: Record<string, unknown>,
  revision: number,
) {
  const key = path + JSON.stringify(body);
  if (!admissions.has(key))
    admissions.set(key, {
      ...body,
      request_id: crypto.randomUUID(),
      expected_revision: revision,
    });
  try {
    return await api(path, "POST", admissions.get(key));
  } catch (error) {
    if (error instanceof HttpError && error.status >= 400 && error.status < 500)
      admissions.delete(key);
    throw error;
  }
}
export function finishAdmission(path: string, body: Record<string, unknown>) {
  admissions.delete(path + JSON.stringify(body));
}

export async function performReportedAction(
  action: () => Promise<void>,
  refresh: () => Promise<void>,
  onFailure: (error: unknown) => void,
  propagateFailure = false,
): Promise<void> {
  try {
    await action();
    await refresh();
  } catch (error) {
    onFailure(error);
    if (propagateFailure) throw error;
  }
}
