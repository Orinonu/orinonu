"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { readDecisions, readFlow, readSnapshot } from "./contracts";
import { queryFailure, singleFlight, type QueryState } from "./query";
import type { DecisionItem, FlowReport, Snapshot } from "./mission";

export type MissionResource = "snapshot" | "flow" | "decisions";
const initial: Record<MissionResource, QueryState> = {
  snapshot: { status: "loading" }, flow: { status: "loading" }, decisions: { status: "loading" },
};

export function useMissionQueries() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [flow, setFlow] = useState<FlowReport[]>([]);
  const [decisions, setDecisions] = useState<DecisionItem[]>([]);
  const [queries, setQueries] = useState(initial);
  const generation = useRef(0);
  const requests = useRef<Partial<Record<MissionResource, () => Promise<void>>>>({});
  const retry = useCallback((resource: MissionResource) => requests.current[resource]?.() ?? Promise.resolve(), []);
  const refresh = useCallback(async () => {
    await Promise.all([retry("snapshot"), retry("flow"), retry("decisions")]);
  }, [retry]);

  useEffect(() => {
    const context = ++generation.current;
    const controller = new AbortController();
    const current = () => context === generation.current && !controller.signal.aborted;
    const load = <T,>(resource: MissionResource, path: string, read: (value: unknown) => T, commit: (value: T) => void) => singleFlight(async () => {
      setQueries(previous => ({ ...previous, [resource]: previous[resource].updatedAt ? previous[resource] : { status: "loading" } }));
      try {
        const value = read(await api(path, "GET", undefined, { signal: controller.signal }));
        if (!current()) return;
        commit(value);
        setQueries(previous => ({ ...previous, [resource]: { status: "ready", updatedAt: new Date().toISOString() } }));
      } catch (error) {
        if (!current()) return;
        const message = error instanceof Error && error.message.includes("incompatível")
          ? "Resposta do servidor incompatível com esta interface."
          : error instanceof Error && error.name === "TimeoutError"
            ? "A consulta excedeu o tempo limite. Tente novamente."
            : "Não foi possível atualizar este recurso. Tente novamente.";
        setQueries(previous => ({ ...previous, [resource]: queryFailure(previous[resource], message) }));
      }
    });
    requests.current = {
      snapshot: load("snapshot", "/api/state", readSnapshot, setSnapshot),
      flow: load("flow", "/api/flow", readFlow, setFlow),
      decisions: load("decisions", "/api/decisions", readDecisions, setDecisions),
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      ++generation.current;
      controller.abort();
      requests.current = {};
      clearInterval(timer);
    };
  }, [refresh]);

  return { snapshot, setSnapshot, flow, decisions, queries, retry, refresh };
}
