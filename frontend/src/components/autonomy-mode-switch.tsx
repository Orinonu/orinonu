"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Bot, Loader2, UserCheck } from "lucide-react";

export type AutonomyModeValue = "supervised" | "autonomous";

/** Explicit two-way choice for the project flow. A segmented radio group is clearer than a
 * switch: both modes are always visible and each says what it means. */
export function AutonomyModeSwitch({
  mode,
  busy,
  disabledReason,
  summary,
  onChange,
  className = "",
}: {
  mode: AutonomyModeValue;
  busy: boolean;
  /** When set, the control is disabled and the reason is shown to the person. */
  disabledReason?: string;
  /** Live flow line, e.g. "0 aguardando você · 7 ativas". */
  summary?: string | null;
  onChange: (next: AutonomyModeValue) => void;
  className?: string;
}) {
  const options: {
    value: AutonomyModeValue;
    label: string;
    hint: string;
    icon: typeof Bot;
  }[] = [
    {
      value: "supervised",
      label: "Supervisionado",
      hint: "As decisões do fluxo aguardam você.",
      icon: UserCheck,
    },
    {
      value: "autonomous",
      label: "Autônomo",
      hint: "O sistema decide, executa, revisa e integra sozinho. Só depende de você para segredos, contas, dados privados, publicação externa e paradas explícitas.",
      icon: Bot,
    },
  ];
  const disabled = busy || !!disabledReason;
  const [focusMode, setFocusMode] = useState(mode);
  const buttons = useRef<Partial<Record<AutonomyModeValue, HTMLButtonElement | null>>>({});
  const helpId = useId();
  useEffect(() => { setFocusMode(mode); }, [mode]);
  return (
    <div className={`autonomy-mode ${className}`} role="toolbar" aria-label="Comandos de modo do projeto" aria-orientation="horizontal">
      <span id={helpId} className="sr-only">Use as setas para navegar; Enter ou Espaço para confirmar o modo do projeto.</span>
      <div
        className={`autonomy-segments is-${mode}`}
        role="radiogroup"
        aria-label="Modo do projeto"
        aria-describedby={helpId}
        aria-busy={busy}
        title={disabledReason}
      >
        <small className="autonomy-caption">MODO DO PROJETO</small>
        {options.map(({ value, label, hint, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            tabIndex={focusMode === value ? 0 : -1}
            ref={button => { buttons.current[value] = button; }}
            title={disabledReason ?? hint}
            disabled={disabled}
            className={`autonomy-option ${mode === value ? "is-selected" : ""}`}
            onFocus={() => setFocusMode(value)}
            onKeyDown={event => {
              if (disabled || event.altKey || event.ctrlKey || event.metaKey) return;
              const index = options.findIndex(option => option.value === value);
              const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? (index + 1) % options.length
                : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (index + options.length - 1) % options.length
                  : event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : null;
              if (next === null) return;
              event.preventDefault();
              buttons.current[options[next].value]?.focus();
            }}
            onClick={() => {
              if (mode !== value) onChange(value);
            }}
          >
            {busy && mode !== value ? (
              <Loader2 className="spin" size={14} />
            ) : (
              <Icon size={14} />
            )}
            <span>{label}</span>
          </button>
        ))}
      </div>
      {(summary || disabledReason) && (
        <small className="autonomy-summary" role="status">
          {disabledReason ?? summary}
        </small>
      )}
    </div>
  );
}
