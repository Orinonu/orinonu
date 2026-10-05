"use client";

import { ArrowUpRight } from "lucide-react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { isActive, laneOf, missionAction, recoveryReasonLabels, taskProgress, waitOwner, type Task } from "../lib/mission";

export function MissionCard({ task, compact = false, specialistName, onOpen, onStart, onStop, busy, pendingDecision = false, startDisabled = false, onDecision }: {
  task: Task;
  compact?: boolean;
  specialistName?: string;
  onOpen: () => void;
  onStart: () => void;
  onStop: () => void;
  busy: boolean;
  pendingDecision?: boolean;
  startDisabled?: boolean;
  onDecision?: () => void;
}) {
  const active = isActive(task), external = task.external_work?.status === "active";
  const percent = taskProgress(task), lane = laneOf(task), owner = waitOwner(task), action = missionAction(task, pendingDecision);
  return <Card className={`mission-card ${active ? "active-mission" : ""} ${compact ? "compact-mission" : ""}`}>
    <div className="mission-card-top">
      <span className="specialist-label">
        <span className="avatar-initial">{(specialistName ?? task.specialist ?? "G").slice(0, 1).toUpperCase()}</span>
        <span className="specialist-name" title={specialistName ?? task.specialist ?? "Engenharia geral"}>{specialistName ?? task.specialist ?? "Engenharia geral"}</span>
      </span>
      {owner && <span className={`mission-owner-chip tone-${owner.tone}`}>{owner.label}</span>}
      {task.execution_agent && task.execution_agent !== "codex" && <span className="mission-owner-chip tone-gold" title={`Provedor: ${task.execution_agent}`}>
        {task.fallback_from ? `Fallback: ${task.execution_agent}` : task.execution_agent}
      </span>}
      <span className={`lane-dot lane-${lane}`} />
    </div>
    <button className="mission-open" onClick={onOpen} title={task.title}>
      <h3>{task.title}</h3>
      {!compact && <p>{task.goal || "Consulte os detalhes desta missão."}</p>}
    </button>
    <div className={`mission-progress ${active ? "is-active" : ""}`}>
      <div className="progress-label"><span>{action.state}</span>{percent !== null && <strong>{percent}%</strong>}</div>
      {percent !== null ? <progress max={100} value={percent} aria-label={"Checklist de " + task.title} />
        : !compact ? <div className={`progress-track ${active && !task.queue ? "indeterminate" : ""}`} aria-label="Progresso indeterminado"><span /></div>
        : <span className="sr-only">Progresso não informado</span>}
      <small className={compact ? "sr-only" : undefined}>
        {(task.queue ? task.queue_wait?.message : undefined)
          ?? (task.decision_recovery?.reason ? recoveryReasonLabels[task.decision_recovery.reason] ?? task.decision_recovery.reason : undefined)
          ?? task.pipeline?.reason
          ?? (task.status !== "backlog" ? task.progress?.events?.at(-1)?.label : undefined)
          ?? (percent === null ? active ? "Aguardando checklist reportado" : "Etapa não iniciada" : "Progresso dos itens reportados")}
      </small>
    </div>
    {!compact && percent !== null && task.progress?.checklist_phase && !external && <small>Checklist de {({ discovery: "exploração", design: "planejamento", planning: "planejamento", implementation: "implementação", review: "revisão" } as Record<string, string>)[task.progress.checklist_phase] ?? "etapa não registrada"}</small>}
    <div className="mission-card-footer">
      {!compact && <small>{task.ended_at || task.created_at ? new Date(task.ended_at ?? task.created_at ?? "").toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "Sem data registrada"}</small>}
      {action.kind === "start" || action.kind === "stop"
        ? <Button variant="outline" size="sm" disabled={busy || (action.kind === "start" && startDisabled)} onClick={action.kind === "start" ? onStart : onStop}>{action.label}</Button>
        : <button className="text-button" onClick={action.kind === "decision" ? onDecision ?? onOpen : onOpen}>{action.label} <ArrowUpRight size={13} /></button>}
    </div>
  </Card>;
}
