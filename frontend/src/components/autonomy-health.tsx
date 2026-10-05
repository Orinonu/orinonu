"use client";

import { Activity, ArrowRight, CircleAlert, Gauge, ShieldAlert, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  capacityRows,
  healthLabels,
  quietLabel,
  stallReasonLabels,
  type FlowReport,
} from "@/lib/mission";

/** Autonomy health: whether work really moves. Queue length is never shown as progress. */
export function AutonomyHealthPanel({
  flow,
  awaitingYou,
  titles,
  onOpenDecisions,
}: {
  flow: FlowReport | null;
  awaitingYou: number;
  titles: Record<string, string>;
  onOpenDecisions: () => void;
}) {
  const health = flow?.health;
  if (!flow || !health) return null;
  const label = healthLabels[health.state] ?? healthLabels.idle,
    rows = capacityRows(health),
    counts = health.counts ?? {},
    breakerOpen = health.breaker?.state === "open";
  return (
    <Card className={`health-panel tone-${label.tone}`} aria-label="Saúde da autonomia">
      <div className="health-head">
        <h2>
          <Gauge size={17} /> Autonomia
        </h2>
        <span className={`health-state state-${label.tone}`} role="status">
          {label.label}
        </span>
      </div>
      <div className="health-stats">
        <div>
          <strong>{(counts.running ?? 0) + (counts.queued_admissible ?? 0)}</strong>
          <small>em movimento</small>
        </div>
        <div>
          <strong>{awaitingYou}</strong>
          <small>aguardando você</small>
        </div>
        <div>
          <strong>{health.stalled.length}</strong>
          <small>parados</small>
        </div>
        <div>
          <strong>
            {health.wip ? `${health.wip.count}/${health.wip.max}` : "—"}
          </strong>
          <small>no pipeline</small>
        </div>
      </div>
      {breakerOpen && (
        <p className="health-alert" role="alert">
          <ShieldAlert size={15} /> Disjuntor aberto: etapas sem avanço verificável pausaram as admissões.{" "}
          <button type="button" onClick={onOpenDecisions}>
            Decidir
          </button>
        </p>
      )}
      {rows.length > 0 && (
        <ul className="capacity-list" aria-label="Vagas por etapa">
          {rows.map((row) => (
            <li key={row.phase}>
              <span>{row.label}</span>
              <span
                className="capacity-bar"
                role="img"
                aria-label={`${row.live} em execução, ${row.phantom} presas, limite ${row.limit}`}
              >
                <i className="live" style={{ width: `${Math.min(100, (100 * row.live) / row.limit)}%` }} />
                <i className="phantom" style={{ width: `${Math.min(100, (100 * row.phantom) / row.limit)}%` }} />
              </span>
              <small>
                {row.live}/{row.limit}
                {row.phantom > 0 && <b> · {row.phantom} presa(s)</b>}
                {row.queued > 0 && ` · ${row.queued} na fila`}
              </small>
            </li>
          ))}
        </ul>
      )}
      {health.stalled.length > 0 && (
        <div className="stall-list">
          <h3>
            <CircleAlert size={14} /> Parados além do prazo
          </h3>
          {health.stalled.slice(0, 3).map((row) => (
            <p key={row.task_id}>
              <strong>{titles[row.task_id] ?? row.task_id.slice(0, 8)}</strong>
              <small>
                {stallReasonLabels[row.reason] ?? row.reason} · sem mudança há {quietLabel(row.quiet_ms)}
              </small>
            </p>
          ))}
        </div>
      )}
      {(health.noop_suppressed ?? 0) > 0 && (
        <p className="health-note">
          <Activity size={13} /> {health.noop_suppressed} candidato(s) sem fase lançável foram silenciados até a capacidade ou a evidência mudar.
        </p>
      )}
      {awaitingYou > 0 && (
        <Button variant="outline" size="sm" onClick={onOpenDecisions}>
          <UserCheck size={14} /> Abrir caixa de decisões <ArrowRight size={14} />
        </Button>
      )}
    </Card>
  );
}
