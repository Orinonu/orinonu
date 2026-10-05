// Capability catalog consulted by JEV executor selection and recorded on each mission at dispatch.
// Every entry describes the contract the supervisor actually applies — never marketing claims:
// cancellation, durable session, usage fields, whether approvals can be bypassed, and where the
// effective model comes from. Executors without a verified contract say so explicitly.
import {HERMES_CONTRACT} from './hermes.mjs';

export const EXECUTOR_CATALOG = Object.freeze({
  codex: Object.freeze({
    transport: 'process', cli: 'codex exec --json', cancellation: 'signal', durable_session: false,
    approval_bypass: false, usage_fields: ['input_tokens', 'output_tokens', 'cached_input_tokens'],
    effective_model: 'profile', sandbox: ['read-only', 'workspace-write'],
  }),
  'codex-appserver': Object.freeze({
    transport: 'jsonrpc-stdio', cli: 'codex app-server', cancellation: 'signal+turn/interrupt',
    durable_session: true, approval_bypass: false,
    usage_fields: ['input_tokens', 'output_tokens', 'cached_input_tokens'], effective_model: 'profile',
    sandbox: ['read-only', 'workspace-write'],
  }),
  hermes: Object.freeze({...HERMES_CONTRACT, sandbox: null}),
  devin: Object.freeze({
    transport: 'unverified', cli: 'devin -p', cancellation: 'signal', durable_session: false,
    approval_bypass: false, usage_fields: [], effective_model: 'event', sandbox: null,
    unavailable_reason: 'O executor automático Devin não possui isolamento verificado; use uma sessão interativa com reserva MCP.',
  }),
  // These entries exist but their end-to-end contract was never verified; nothing may treat them as
  // real executors until a probe proves the invocation surface like the Hermes one was proven.
  antigravity: Object.freeze({ transport: 'unverified', cli: 'antigravity', cancellation: 'unknown', durable_session: 'unknown', approval_bypass: 'unknown', usage_fields: [], effective_model: 'unknown', sandbox: null }),
  openrouter: Object.freeze({ transport: 'unverified', cli: 'openrouter placeholder', cancellation: 'unknown', durable_session: 'unknown', approval_bypass: 'unknown', usage_fields: [], effective_model: 'unknown', sandbox: null }),
});

export const executorContract = providerId => EXECUTOR_CATALOG[providerId] ?? null;
export const isExecutableProvider = providerId => Boolean(executorContract(providerId)&&executorContract(providerId).transport!=='unverified');
