"use client";

import { useId, useRef, useState, type CSSProperties } from "react";
import { ArrowUpRight, GitBranch, Search, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { Snapshot, Specialist } from "@/lib/mission";

const accents: Record<string, string> = {
  "frontend-lead": "var(--neural-cyan)",
  "backend-lead": "var(--celestial-gold)",
  "ui-design-lead": "var(--rose)",
  reviewer: "var(--success)",
  "opportunity-analyst": "var(--warning)",
};
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function specialistLineage(role: Specialist, roles: Specialist[]) {
  const lineage = [role], visited = new Set([role.id]);
  let parent = role.parent;
  while (parent) {
    const leader = roles.find(candidate => candidate.id === parent);
    if (!leader || visited.has(leader.id)) break;
    lineage.push(leader); visited.add(leader.id); parent = leader.parent;
  }
  return lineage;
}

export function filterSpecialists(roles: Specialist[], query = "", leader = "all") {
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  return roles.filter(role => {
    const lineage = specialistLineage(role, roles);
    const text = normalize([role.id, role.name, role.scope, ...(role.skills ?? []), ...lineage.map(member => member.name)].join(" "));
    const inTeam = leader === "all" || (leader === "transversal"
      ? !role.parent && !roles.some(member => member.parent === role.id)
      : lineage.some(member => member.id === leader));
    return inTeam && terms.every(term => text.includes(term));
  });
}

export function SpecialistPortrait({ role }: { role: Specialist }) {
  const seed = Array.from(role.id).reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0, 17);
  const headWidth = 66 + seed % 13, left = 80 - headWidth / 2;
  const visorY = 62 + (seed >>> 4) % 7, eyes = 13 + (seed >>> 8) % 6;
  const variant = (seed >>> 12) % 4;
  return <svg className="specialist-portrait" viewBox="0 0 160 160" role="img" aria-label={`Avatar ilustrado de ${role.name}`}>
    <circle cx="80" cy="80" r="80" fill="var(--surface-raised)" />
    <circle cx="80" cy="80" r="64" fill="none" stroke="var(--specialist-accent, var(--celestial-gold))" strokeOpacity=".2" />
    <path d="M15 112 145 48M18 48l126 64" stroke="var(--specialist-accent, var(--celestial-gold))" strokeOpacity=".1" />
    <path d="M26 160v-15c0-25 24-40 54-40s54 15 54 40v15" fill="var(--specialist-accent, var(--celestial-gold))" />
    <path d="m52 115 28 20 28-20v45H52Z" fill="var(--surface-panel)" />
    <rect x="68" y="98" width="24" height="24" rx="9" fill="var(--border-strong)" />
    <rect x={left - 9} y="68" width="12" height="24" rx="5" fill="var(--specialist-accent, var(--celestial-gold))" />
    <rect x={left + headWidth - 3} y="68" width="12" height="24" rx="5" fill="var(--specialist-accent, var(--celestial-gold))" />
    <rect x={left} y="40" width={headWidth} height="70" rx={variant === 1 ? 28 : 19} fill="var(--text-primary)" />
    <path d={`M${left + 12} 47h${headWidth - 24}`} stroke="var(--border-strong)" strokeWidth="3" strokeLinecap="round" />
    <rect x={left + 8} y={visorY} width={headWidth - 16} height="22" rx={variant === 2 ? 5 : 11} fill="var(--surface-base)" />
    <g fill="var(--specialist-accent, var(--celestial-gold))">
      {variant === 3 ? <><path d={`m${80 - eyes - 4} ${visorY + 13} 4-5 4 5M${80 + eyes - 4} ${visorY + 13}l4-5 4 5`} fill="none" stroke="var(--specialist-accent, var(--celestial-gold))" strokeWidth="3" strokeLinecap="round" /></> : <><rect x={80 - eyes - 3} y={visorY + 7} width="6" height="8" rx={variant === 0 ? 3 : 1} /><rect x={80 + eyes - 3} y={visorY + 7} width="6" height="8" rx={variant === 0 ? 3 : 1} /></>}
    </g>
    <path d="M72 96h16" stroke="var(--border-strong)" strokeWidth="3" strokeLinecap="round" />
    {variant === 0 ? <><path d="M80 40V29" stroke="var(--text-secondary)" strokeWidth="4" /><circle cx="80" cy="25" r="6" fill="var(--specialist-accent, var(--celestial-gold))" /></> : variant === 1 ? <path d="M59 42V32h42v10" fill="var(--specialist-accent, var(--celestial-gold))" /> : variant === 2 ? <path d="m64 41 9-12h14l9 12" fill="var(--specialist-accent, var(--celestial-gold))" /> : <><circle cx="59" cy="40" r="7" fill="var(--specialist-accent, var(--celestial-gold))" /><circle cx="101" cy="40" r="7" fill="var(--specialist-accent, var(--celestial-gold))" /></>}
    <circle cx="80" cy="145" r="5" fill="var(--specialist-accent, var(--celestial-gold))" />
    <path d={`M${32 + (seed >>> 16) % 12} 139v12`} stroke="var(--surface-panel)" strokeWidth="3" strokeLinecap="round" />
  </svg>;
}

function SpecialistCard({ role, roles, onTeam }: { role: Specialist; roles: Specialist[]; onTeam: (id: string) => void }) {
  const title = useRef<HTMLHeadingElement>(null);
  const lineage = specialistLineage(role, roles), leader = lineage[1], family = lineage.at(-1)!;
  const children = roles.filter(member => member.parent === role.id);
  const position = children.length ? "Liderança de especialidade" : role.parent ? "Especialista" : "Especialista transversal";
  const leadership = leader ? `Liderança: ${leader.name}` : role.parent ? "Liderança não encontrada no catálogo" : children.length ? "Sem líder acima no catálogo" : "Função transversal";
  const style: CSSProperties & { "--specialist-accent": string } = { "--specialist-accent": accents[family.id] ?? "var(--neural-cyan)" };
  return <article className="specialist-card" style={style}>
    <div className="specialist-cover"><span>{children.length ? <GitBranch size={15} /> : <Users size={15} />}{children.length ? "Liderança" : "Especialista"}</span><span className="specialist-contract">Perfil sob demanda</span></div>
    <div className="specialist-card-body">
      <SpecialistPortrait role={role} />
      <span className="specialist-handle">@{role.id}</span>
      <h3>{role.name}</h3>
      <p className="specialist-position">{position}</p>
      <p className="specialist-bio">{role.scope?.split(/\.\s/)[0] || "Especialidade não informada."}</p>
      <div className="specialist-skills" aria-label={`Skills candidatas de ${role.name}`}>
        {(role.skills ?? []).slice(0, 2).map(skill => <span key={skill}>{skill}</span>)}
        {(role.skills?.length ?? 0) > 2 && <span>+{role.skills!.length - 2}</span>}
        {!role.skills?.length && <span>Skills não informadas</span>}
      </div>
      {leader ? <button type="button" className="specialist-leader" onClick={() => onTeam(leader.id)} aria-label={`Filtrar equipe de ${leader.name}`}><GitBranch size={14} />{leadership}</button> : <p className="specialist-leader"><GitBranch size={14} />{leadership}</p>}
      <Dialog>
        <DialogTrigger asChild><Button variant="outline" className="specialist-open" aria-label={`Ver perfil de ${role.name}`}>Ver perfil<ArrowUpRight size={15} /></Button></DialogTrigger>
        <DialogContent className="specialist-dialog" style={style} onOpenAutoFocus={event => { event.preventDefault(); title.current?.focus(); }}>
          <DialogHeader>
            <SpecialistPortrait role={role} />
            <span className="specialist-handle">@{role.id}</span>
            <DialogTitle ref={title} tabIndex={-1}>{role.name}</DialogTitle>
            <DialogDescription>{position} · contrato de escopo sob demanda</DialogDescription>
          </DialogHeader>
          <section className="specialist-detail"><h3>Especialidade e responsabilidades</h3><p>{role.scope || "Escopo não informado nesta instalação."}</p></section>
          <section className="specialist-detail"><h3>Liderança e equipe</h3><p>{leadership}</p>
            {lineage.length > 2 && <p>{[...lineage].reverse().map(member => member.name).join(" → ")}</p>}
            {!!children.length && <><p>{children.length} especialistas vinculados no catálogo:</p><ul>{children.map(child => <li key={child.id}>{child.name}</li>)}</ul></>}
          </section>
          <section className="specialist-detail"><h3>Skills candidatas</h3><div className="specialist-skills">{role.skills?.map(skill => <span key={skill}>{skill}</span>)}</div>{!role.skills?.length && <p>Não informadas.</p>}<p className="native-copy">São referências de trabalho, não ferramentas ou permissões automaticamente concedidas.</p></section>
          <p className="specialist-disclaimer">Este perfil descreve um contrato de escopo. A presença no catálogo, por si só, não comprova uma instância do OpenAI Agents SDK, memória própria ou delegação ativa. Consulte a configuração declarada do runtime e as evidências de execução da instalação. O avatar é uma ilustração, não uma pessoa ou conexão observada.</p>
        </DialogContent>
      </Dialog>
    </div>
  </article>;
}

export function SpecialistRuntime({ policy }: { policy?: Snapshot["specialist_policy"] }) {
  const heading = useId(), runtime = policy?.runtime;
  const facts: { label: string; value?: string; unknown: string; labels: Record<string, string> }[] = [
    { label: "Runtime dos especialistas", value: runtime?.kind, unknown: "Runtime não informado", labels: { executor_prompt: "Contratos de prompt", agents_sdk: "Agents SDK declarado" } },
    { label: "OpenAI Agents SDK", value: runtime?.openai_agents_sdk, unknown: "Não verificado", labels: { not_integrated: "Não integrado nesta declaração", integrated: "Integração declarada" } },
    { label: "Handoffs entre especialistas", value: runtime?.handoffs, unknown: "Não verificados", labels: { not_connected: "Não conectados nesta declaração", connected: "Conexão declarada" } },
    { label: "Memória por especialista", value: policy?.memory_status, unknown: "Não verificada", labels: { not_connected: "Não conectada nesta declaração", connected: "Conexão declarada" } },
    { label: "Allowlist de ferramentas", value: policy?.tool_allowlist_status, unknown: "Não verificada", labels: { not_enforced: "Não aplicada por especialista nesta declaração", enforced: "Aplicação declarada" } },
  ];
  return <Card className="specialist-runtime" role="region" aria-labelledby={heading}>
    <div className="specialist-catalog-heading"><div><span className="eyebrow"><GitBranch size={14} /> Integração real</span><h2 id={heading}>Configuração do swarm</h2><p>Estado declarado pelo backend desta instalação. Perfis no catálogo não comprovam agentes SDK em execução.</p></div></div>
    <dl className="specialist-runtime-facts">{facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value ? <>{fact.labels[fact.value] ?? "Estado declarado"} · <code>{fact.value}</code></> : fact.unknown}</dd></div>)}</dl>
    <details className="specialist-runtime-details"><summary>Contratos e evidências da integração</summary><ul>
      <li>Uma declaração de integração não demonstra despacho real, autenticação ou swarm em execução.</li>
      <li>Ferramentas e handoffs dependem de contratos de autorização, isolamento, orçamento e cancelamento.</li>
      <li>Contexto e memória precisam de escopo, proveniência e verificações independentes de cada entrega.</li>
    </ul><p>{policy?.tool_policy ?? "Política de ferramentas não informada pelo servidor."}</p><p>{policy?.hierarchy ?? "Contrato de hierarquia não informado pelo servidor."}</p><p>Codex CLI e Codex app-server não são o Agents SDK. Uma integração SDK precisa verificar seu próprio método de autenticação e cobrança; não se presume cobertura pela assinatura.</p></details>
  </Card>;
}

export function SpecialistCatalog({ roles }: { roles?: Specialist[] }) {
  const [query, setQuery] = useState(""), [leader, setLeader] = useState("all");
  const heading = useId(), catalog = roles ?? [];
  const leaders = catalog.filter(role => catalog.some(member => member.parent === role.id));
  const visible = filterSpecialists(catalog, query, leader);
  const filtered = !!query || leader !== "all";
  return <Card className="specialist-catalog" role="region" aria-labelledby={heading}>
    <div className="specialist-catalog-heading"><div><span className="eyebrow"><Users size={14} /> Especialidades da instalação</span><h2 id={heading}>Catálogo de especialistas</h2><p>Catálogo global, compartilhado por todos os projetos. Conheça cada especialidade e sua liderança declarada.</p></div><span className="specialist-total">{roles ? `${catalog.length} ${catalog.length === 1 ? "perfil" : "perfis"}` : "Não observado"}</span></div>
    <div className="specialist-toolbar">
      <label className="specialist-search"><Search size={17} aria-hidden="true" /><Input aria-label="Buscar especialistas" placeholder="Buscar nome, especialidade ou skill…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label className="specialist-filter"><span className="sr-only">Filtrar por liderança</span><select aria-label="Filtrar por liderança" value={leader} onChange={event => setLeader(event.target.value)}><option value="all">Todas as lideranças</option>{leader !== "all" && leader !== "transversal" && !leaders.some(role => role.id === leader) && <option value={leader}>Liderança fora do catálogo: {leader}</option>}{leaders.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}<option value="transversal">Funções transversais</option></select></label>
      {filtered && <Button variant="ghost" onClick={() => { setQuery(""); setLeader("all"); }}>Limpar filtros</Button>}
    </div>
    <div className="specialist-results" role="status">{roles ? `${visible.length} de ${catalog.length} ${catalog.length === 1 ? "perfil" : "perfis"} no catálogo${filtered ? " · filtro aplicado" : ""}` : "Catálogo ainda não observado nesta instalação."}</div>
    <div className="specialist-grid">{visible.map(role => <SpecialistCard key={role.id} role={role} roles={catalog} onTeam={setLeader} />)}</div>
    {roles && !visible.length && <div className="specialist-empty"><Users size={28} /><h3>{catalog.length ? "Nenhum especialista encontrado" : "Nenhum especialista cadastrado"}</h3><p>{catalog.length ? "Tente outra especialidade ou limpe os filtros para ver toda a equipe." : "A instalação retornou um catálogo vazio."}</p></div>}
    <p className="specialist-catalog-note">Avatares ilustrados, gerados localmente para cada perfil. A hierarquia organiza escopos; não representa agentes filhos ativos. Ferramentas, permissões e memória dependem da integração efetiva.</p>
  </Card>;
}
