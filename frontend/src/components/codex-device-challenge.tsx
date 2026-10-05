import { Button } from "@/components/ui/button";

export type CodexLogin = {
  status?: string;
  verification_url?: string;
  user_code?: string;
};

export function CodexDeviceChallenge({ login, onCancel }: { login?: CodexLogin; onCancel: () => void }) {
  if (!login || ["idle", "authenticated", "completed", "cancelled"].includes(login.status ?? "idle")) return null;
  const active = ["checking", "starting", "awaiting_user"].includes(login.status ?? "");
  const validChallenge = login.status === "awaiting_user" && login.verification_url === "https://auth.openai.com/codex/device" && /^[A-Z0-9]{4}-[A-Z0-9]{4,5}$/.test(login.user_code ?? "");
  const message = login.status === "approval_required"
    ? "Sua autenticação existente por API key foi preservada. Alterá-la exige uma escolha explícita no cliente Codex."
    : login.status === "expired" ? "O código de login expirou. Inicie uma nova conexão."
    : login.status === "failed" || login.status === "unavailable" ? "Login indisponível. Verifique a instalação do Codex CLI."
    : "Preparando o login oficial do Codex. Nenhuma chave do JEV é usada para autenticar o Codex.";
  return (
    <section className="native-item" aria-label="Login por dispositivo do Codex">
      {validChallenge ? (
        <>
          <p>Abra a página oficial e informe este código temporário da sua instalação:</p>
          <p><code>{login.user_code}</code></p>
          <a href={login.verification_url} target="_blank" rel="noopener noreferrer">Abrir login oficial do Codex</a>
          <p className="native-copy">Não compartilhe este código. A conexão só é confirmada após o Codex verificar sua própria autenticação.</p>
        </>
      ) : <p role="status">{message}</p>}
      {active && <Button type="button" variant="outline" onClick={onCancel}>Cancelar login</Button>}
    </section>
  );
}
