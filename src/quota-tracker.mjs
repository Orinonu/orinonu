import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {defaultDevinCli} from './providers.mjs';
import {executorContract,isExecutableProvider} from './executor-catalog.mjs';

const DEFAULT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour cooldown when quota is depleted

export function createQuotaTracker({
  providerSettings,
  currencyService = null,
  codexAuth = null,
  fetcher = fetch,
  now = () => Date.now(),
  antigravityPath = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'antigravity', 'Antigravity.exe'),
  devinPath = defaultDevinCli(),
  devinProbe = () => null,
  hermesPath = null,
  hermesProbe = () => null,
} = {}) {
  // Store runtime status, rate limits, observed usage and cooldowns
  const states = new Map();

  // codex-appserver is a transport of the codex provider: same login, same subscription quota.
  const normalizeId = providerId => providerId === 'codex-appserver' ? 'codex' : providerId;

  function getOrInit(providerId) {
    providerId = normalizeId(providerId);
    if (!states.has(providerId)) {
      states.set(providerId, {
        status: 'unknown',
        quota_depleted_at: null,
        cooldown_until: null,
        last_reason: null,
        observed: { input_tokens: 0, output_tokens: 0, calls: 0, errors: 0 },
        remote_quota: null,
        last_checked: null,
      });
    }
    return states.get(providerId);
  }

  function recordUsage(providerId, { inputTokens = 0, outputTokens = 0, calls = 1, error = false } = {}) {
    const s = getOrInit(providerId);
    s.observed.input_tokens += Number.isFinite(inputTokens) && inputTokens > 0 ? inputTokens : 0;
    s.observed.output_tokens += Number.isFinite(outputTokens) && outputTokens > 0 ? outputTokens : 0;
    s.observed.calls += calls;
    if (error) s.observed.errors += 1;
  }

  function markQuotaDepleted(providerId, { reason = 'Cota limite atingida', cooldownMs = DEFAULT_COOLDOWN_MS } = {}) {
    const s = getOrInit(providerId);
    const currentTime = now();
    s.quota_depleted_at = currentTime;
    s.cooldown_until = currentTime + cooldownMs;
    s.last_reason = String(reason).slice(0, 300);
    s.status = 'quota_depleted';
  }

  function resetQuota(providerId) {
    const s = getOrInit(providerId);
    s.quota_depleted_at = null;
    s.cooldown_until = null;
    s.last_reason = null;
    s.status = 'active';
  }

  function isQuotaDepleted(providerId) {
    const s = states.get(normalizeId(providerId));
    if (!s) return false;
    const currentTime = now();
    if (s.cooldown_until && s.cooldown_until > currentTime) {
      return true;
    }
    return false;
  }

  function calculateDaysRemaining(expiryIso) {
    if (!expiryIso) return null;
    const target = Date.parse(expiryIso);
    if (!Number.isFinite(target)) return null;
    const diffMs = target - now();
    return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  }

  async function refreshRemoteQuota(providerId) {
    const creds = providerSettings?.credentials(providerId);
    if (!creds?.key) return null;
    const s = getOrInit(providerId);

    if (providerId === 'openrouter') {
      try {
        const res = await fetcher('https://openrouter.ai/api/v1/auth/key', {
          headers: { Authorization: `Bearer ${creds.key}` },
        });
        if (res.ok) {
          const body = await res.json();
          if (body?.data) {
            s.remote_quota = {
              label: body.data.label ?? 'Chave OpenRouter',
              usage_usd: typeof body.data.usage === 'number' ? body.data.usage : null,
              limit_usd: typeof body.data.limit === 'number' ? body.data.limit : null,
              is_free_tier: Boolean(body.data.is_free_tier),
              rate_limit: body.data.rate_limit ?? null,
            };
            s.last_checked = now();
            if (s.remote_quota.limit_usd !== null && s.remote_quota.usage_usd !== null && s.remote_quota.usage_usd >= s.remote_quota.limit_usd) {
              markQuotaDepleted('openrouter', { reason: 'Limite de crédito da chave OpenRouter atingido' });
            }
          }
        }
      } catch {
        /* best-effort network check */
      }
    }
    return s.remote_quota;
  }

  function isEligible(providerId) {
    providerId = normalizeId(providerId);
    if (!isExecutableProvider(providerId)) return false;
    if (providerId === 'hermes') {
      // No stored credential — Hermes authenticates through its own pooled providers; eligibility means
      // the installed binary passed the dispatch probe (flags + auth status) recently.
      return Boolean(hermesPath && existsSync(hermesPath) && hermesProbe()?.ok);
    }
    const creds = providerSettings?.credentials(providerId);
    if (!creds || !creds.enabled) return false;
    const s = getOrInit(providerId);
    const currentTime = now();

    // Check cooldown
    if (s.cooldown_until && s.cooldown_until > currentTime) {
      return false;
    }
    if (s.cooldown_until && s.cooldown_until <= currentTime) {
      // Cooldown expired, restore
      s.cooldown_until = null;
      s.quota_depleted_at = null;
    }

    if (providerId === 'codex') {
      if (codexAuth) {
        const authStatus = codexAuth.state()?.status;
        if (authStatus === 'unauthenticated') return false;
      }
      return true;
    }

    if (providerId === 'devin') {
      const days = calculateDaysRemaining(creds.expires_at);
      if (days !== null && days < 0) return false;
      return Boolean(devinPath && existsSync(devinPath) && devinProbe()?.cli_authenticated === true);
    }

    return false;
  }

  function getSummary() {
    const meta = providerSettings?.metadata() ?? { providers: [], fallback_chain: [], auto_fallback: true };
    const currentTime = now();
    const quote = currencyService?.get?.() ?? null;
    const candidateRate = quote !== null ? quote.usd_brl : currencyService?.getRate?.() ?? null;
    const brlRate = Number.isFinite(candidateRate) && candidateRate > 0 ? candidateRate : null; // Unknown quotes remain unknown.
    const amount = value => Number.isFinite(value) && value >= 0 ? value : null;
    const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
    const currency = {
      usd_brl: brlRate,
      source: typeof quote?.source === 'string' && quote.source.trim() ? quote.source : brlRate !== null ? 'currency_service' : 'unknown',
      fetched_at: timestamp(quote?.fetched_at),
      observed_at: timestamp(quote?.observed_at),
      status: brlRate === null ? 'unavailable' : typeof quote?.status === 'string' ? quote.status : 'available',
    };
    const brl = usd => usd !== null && brlRate !== null ? amount(Math.round(usd * brlRate * 100) / 100) : null;

    const providers = meta.providers.map(p => {
      const s = getOrInit(p.id);
      const creds = providerSettings?.credentials(p.id);
      let status = 'ready';
      let statusLabel = 'Pronto para execução';
      let limitDetail = null;
      const lastChecked = Number.isFinite(s.last_checked) ? new Date(s.last_checked).toISOString() : null;
      if (p.id === 'openrouter' && s.remote_quota) {
        const used = amount(s.remote_quota.usage_usd), limit = amount(s.remote_quota.limit_usd);
        const remaining = limit !== null && used !== null ? Math.max(0, limit - used) : null;
        limitDetail = {
          used_usd: used, used_brl: brl(used),
          limit_usd: limit, limit_brl: brl(limit),
          remaining_usd: remaining, remaining_brl: brl(remaining),
          is_free_tier: s.remote_quota.is_free_tier,
          source: 'https://openrouter.ai/api/v1/auth/key',
          observed_at: lastChecked,
        };
      }

      // Cooldown check
      if (s.cooldown_until && s.cooldown_until > currentTime) {
        status = 'quota_depleted';
        const minsLeft = Math.ceil((s.cooldown_until - currentTime) / 60000);
        statusLabel = `Cota no limite · cooldown de ${minsLeft}m (${s.last_reason ?? '429 / Rate Limit'})`;
      } else if (!p.enabled) {
        status = 'disabled';
        statusLabel = 'Desativado nas configurações';
      } else if (p.id === 'codex') {
        const authState = codexAuth?.state() ?? {};
        if (authState.status === 'chatgpt') {
          status = 'ready';
          statusLabel = 'Assinatura ChatGPT conectada · Limites compartilhados com a conta';
        } else if (authState.status === 'api_key') {
          status = 'ready';
          statusLabel = 'Autenticado via API Key oficial';
        } else if (authState.status === 'unauthenticated') {
          status = 'unauthenticated';
          statusLabel = 'Login pendente na conta OpenAI';
        } else {
          status = 'unavailable';
          statusLabel = 'Codex CLI indisponível localmente';
        }
      } else if (p.id === 'antigravity') {
        const installed = existsSync(antigravityPath);
        const hasKey = Boolean(creds?.key?.trim());
        if (installed && hasKey) {
          status = 'ready';
          statusLabel = 'Antigravity local + Chave Google Gemini conectadas';
        } else if (installed) {
          status = 'ready';
          statusLabel = 'Google Antigravity instalado localmente';
        } else if (hasKey) {
          status = 'ready';
          statusLabel = 'Chave Google Gemini configurada';
        } else {
          status = 'unauthenticated';
          statusLabel = 'Configure a chave Google ou execute o Antigravity';
        }
      } else if (p.id === 'devin') {
        const days = calculateDaysRemaining(p.expires_at);
        const authenticated = devinPath && existsSync(devinPath) && devinProbe()?.cli_authenticated === true;
        if (days !== null && days < 0) {
          status = 'expired';
          statusLabel = `Política local expirou em ${p.expires_at}; assinatura não verificada`;
        } else if (authenticated) {
          status = 'ready';
          statusLabel = days === null ? 'Login do Devin CLI verificado; validade da assinatura desconhecida' : `Login CLI verificado · política local: ${days} dias restantes; assinatura não verificada`;
        } else {
          status = 'unauthenticated';
          statusLabel = 'Login do Devin CLI não verificado; instalação ou token não autoriza execução';
        }
      } else if (p.id === 'openrouter') {
        if (!creds?.key) {
          status = 'unauthenticated';
          statusLabel = 'Chave de API OpenRouter não configurada';
        } else if (limitDetail) {
          const remaining = limitDetail.remaining_usd;
          if (remaining !== null && remaining <= 0) {
            status = 'quota_depleted';
            statusLabel = 'Limite de crédito OpenRouter esgotado';
          } else {
            status = 'ready';
            statusLabel = remaining !== null ? `Saldo restante observado: $${remaining.toFixed(2)}` : 'Saldo restante não verificado';
          }
        } else {
          status = 'ready';
          statusLabel = 'Chave OpenRouter configurada';
        }
      } else if (p.id === 'anthropic') {
        if (!creds?.key) {
          status = 'unauthenticated';
          statusLabel = 'Chave de API Anthropic não configurada';
        } else {
          status = 'ready';
          statusLabel = 'Chave Anthropic configurada';
        }
      }

      if (p.enabled && !isExecutableProvider(p.id)) {
        status = 'unavailable';
        statusLabel = 'Execução indisponível: ' + (executorContract(p.id)?.unavailable_reason ?? 'adaptador sem contrato verificado; credenciais não concedem execução');
        if (p.id === 'devin' && p.expires_at) statusLabel += ` Política local: ${calculateDaysRemaining(p.expires_at)} dias restantes; assinatura não verificada.`;
      }
      return {
        id: p.id,
        name: p.name,
        category: p.category,
        model: p.model,
        enabled: p.enabled,
        status,
        status_label: statusLabel,
        eligible_for_execution: isEligible(p.id),
        observed_usage: { ...s.observed },
        cooldown_until: s.cooldown_until ? new Date(s.cooldown_until).toISOString() : null,
        quota_depleted_at: s.quota_depleted_at ? new Date(s.quota_depleted_at).toISOString() : null,
        limit_detail: limitDetail,
        last_checked: lastChecked,
        expires_at: p.expires_at,
        expires_at_source: p.expires_at_source ?? (p.expires_at ? 'local_policy' : 'unknown'),
      };
    });

    return {
      providers,
      fallback_chain: meta.fallback_chain,
      auto_fallback: meta.auto_fallback,
      currency,
      current_time: new Date(currentTime).toISOString(),
    };
  }

  return {
    recordUsage,
    markQuotaDepleted,
    resetQuota,
    isEligible,
    isQuotaDepleted,
    refreshRemoteQuota,
    getSummary,
  };
}
