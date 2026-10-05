"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle2, Inbox, Loader2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  ageLabel,
  recommendationLabel,
  recommendedOption,
  type DecisionItem,
} from "@/lib/mission";

export type AnswerDecision = (
  item: DecisionItem,
  optionId: string,
  note?: string,
) => Promise<void> | void;

/** Compact card for the overview: the oldest questions and the way into the inbox. */
export function DecisionInboxCard({
  items,
  onOpen,
}: {
  items: DecisionItem[];
  onOpen: () => void;
}) {
  return (
    <Card className="inbox-card" aria-label="Caixa de decisões">
      <div className="health-head">
        <h2>
          <Inbox size={17} /> Caixa de decisões
          <span className="count-badge">{items.length}</span>
        </h2>
      </div>
      {items.length === 0 ? (
        <p className="empty-copy">
          <CheckCircle2 size={14} /> Nada espera por você. O Jev e o host seguem o fluxo.
        </p>
      ) : (
        <ul className="inbox-preview">
          {items.slice(0, 3).map((item) => {
            const rec = recommendationLabel(item);
            return (
              <li key={item.id}>
                <strong>{item.title}</strong>
                <small>
                  {item.label} · {ageLabel(item.since)}
                </small>
                <span className={`rec rec-${rec.tone}`}>{rec.text}</span>
              </li>
            );
          })}
        </ul>
      )}
      {items.length > 0 && (
        <Button variant="outline" size="sm" onClick={onOpen}>
          Responder agora <ArrowRight size={14} />
        </Button>
      )}
    </Card>
  );
}

/** Full inbox: each gate with its typed options and the Jev recommendation beside them. */
export function DecisionInbox({
  items,
  busy,
  onAnswer,
}: {
  items: DecisionItem[];
  busy: string | null;
  onAnswer: AnswerDecision;
}) {
  const [chosen, setChosen] = useState<Record<string, string>>({}),
    [notes, setNotes] = useState<Record<string, string>>({});
  if (!items.length)
    return (
      <Card className="inbox-empty">
        <CheckCircle2 size={22} />
        <h3>Nada espera por você</h3>
        <p>Quando o fluxo precisar de uma decisão humana, ela aparece aqui com as opções e a recomendação do Jev.</p>
      </Card>
    );
  return (
    <div className="inbox-list" role="list">
      {items.map((item) => {
        const option = recommendedOption(item),
          rec = recommendationLabel(item),
          selected = chosen[item.id] ?? "",
          selectedOption = item.options.find((row) => row.id === selected),
          note = notes[item.id] ?? "",
          working = busy === "decision-" + item.id,
          needsNote = !!selectedOption?.requires_note;
        return (
          <Card className="inbox-item" key={item.id} role="listitem">
            <div className="inbox-head">
              <div>
                <Badge variant="outline">{item.label}</Badge>
                <h3>{item.title}</h3>
              </div>
              <small>{ageLabel(item.since)}</small>
            </div>
            {item.questions.map((question) => (
              <p className="inbox-question" key={question}>
                {question}
              </p>
            ))}
            <p className={`rec rec-${rec.tone}`}>
              <Sparkles size={14} /> {rec.text}
            </p>
            <fieldset className="inbox-options" disabled={working}>
              <legend className="sr-only">Opções para {item.title}</legend>
              {item.options.map((row) => (
                <label
                  key={row.id}
                  className={`inbox-option ${selected === row.id ? "selected" : ""} ${option?.id === row.id ? "recommended" : ""}`}
                >
                  <input
                    type="radio"
                    name={"decision-" + item.id}
                    value={row.id}
                    checked={selected === row.id}
                    onChange={() => setChosen((current) => ({ ...current, [item.id]: row.id }))}
                  />
                  <span>
                    <strong>
                      {row.label}
                      {option?.id === row.id && <em> · sugestão do Jev</em>}
                    </strong>
                    <small>
                      {row.effect}
                      {!row.reversible && " Não pode ser desfeito."}
                    </small>
                  </span>
                </label>
              ))}
            </fieldset>
            {needsNote && (
              <label className="form-field" htmlFor={"note-" + item.id}>
                <span>Sua resposta</span>
                <Textarea
                  id={"note-" + item.id}
                  rows={3}
                  maxLength={500}
                  value={note}
                  onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))}
                  placeholder="Registrada como dado da missão; não amplia escopo, permissões nem orçamento."
                />
              </label>
            )}
            <div className="inbox-actions">
              {option && (
                <Button
                  variant="outline"
                  disabled={working || !!busy}
                  onClick={() => void onAnswer(item, option.id)}
                >
                  Aceitar sugestão do Jev
                </Button>
              )}
              <Button
                disabled={working || !!busy || !selected || (needsNote && !note.trim())}
                onClick={() => void onAnswer(item, selected, needsNote ? note.trim() : undefined)}
              >
                {working ? <Loader2 className="spin" size={15} /> : <CheckCircle2 size={15} />}
                Responder
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
