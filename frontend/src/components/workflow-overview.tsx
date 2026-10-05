import { Compass, FlaskConical, GitBranch, MessageSquare, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { Snapshot } from "@/lib/mission";

const steps = [
  { id: "discovery", title: "Explorar", skill: "Wayfinder", icon: Compass, description: "Investigar o contexto, as evidências e os caminhos possíveis." },
  { id: "design", title: "Definir", skill: "Grill with docs", icon: MessageSquare, description: "Esclarecer requisitos e preparar um plano com critérios verificáveis." },
  { id: "implementation", title: "Construir", skill: "TDD", icon: FlaskConical, description: "Testar e implementar o escopo autorizado em workspace isolado." },
  { id: "review", title: "Verificar", skill: "Code review", icon: ShieldCheck, description: "Realizar revisão independente e conferir as evidências da entrega." },
];

const skillLabels: Record<string, string> = {
  wayfinder: "Wayfinder",
  "grill-with-docs": "Grill with docs",
  "grill-me": "Grill me",
  tdd: "TDD",
  "code-review": "Code review",
};

export function WorkflowOverview({ profiles }: { profiles?: Snapshot["profiles"] }) {
  return (
    <Card className="workflow-panel" role="region" aria-labelledby="workflow-title">
      <div className="section-title">
        <div>
          <h2 id="workflow-title"><GitBranch size={18} /> Fluxo de trabalho inteligente</h2>
          <p>Da exploração à entrega, com direção e critérios verificáveis.</p>
        </div>
      </div>
      <ol className="workflow-steps" aria-label="Etapas do fluxo">
        {steps.map((step, index) => (
          <li key={step.id}>
            <div className="workflow-step-top"><span>{String(index + 1).padStart(2, "0")}</span><step.icon size={20} /></div>
            <h3>{step.title}</h3>
            <span className="workflow-skill">{profiles?.[step.id]?.skill ? skillLabels[profiles[step.id].skill] ?? profiles[step.id].skill : step.skill}</span>
            <p>{step.description}</p>
          </li>
        ))}
      </ol>
      <div className="workflow-guidance">
        <GitBranch size={18} aria-hidden="true" />
        <p><strong>JEV recomenda; código valida.</strong> O JEV recomenda etapas e especialistas; o código valida contratos, autorizações e orçamento. Testes e revisão independente verificam a entrega.</p>
      </div>
      <p className="workflow-note">Sequência de referência: as etapas são selecionadas conforme a missão. Atividade não equivale a conclusão nem autoriza integração.</p>
    </Card>
  );
}
