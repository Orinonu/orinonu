// Removes credentials from executor output before it is persisted, logged or fed to recovery. Replacements keep the
// surrounding syntax intact, so a structured report (nexo-plan, nexo-review, JSON events) stays parseable and its
// non-sensitive evidence survives. Redaction is best effort over known shapes, not a proof that no secret remains.
const MARK='[redacted]';
const KEY='(?:password|passwd|pwd|senha|secret|client[_-]?secret|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|token|authorization|private[_-]?key)';
const rules=[
 [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,MARK],
 [/\bBearer\s+[A-Za-z0-9._~+\/=-]{8,}/gi,`Bearer ${MARK}`],
 [/\bBasic\s+[A-Za-z0-9+\/=]{12,}/g,`Basic ${MARK}`],
 [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g,MARK],
 [/\bsk-[A-Za-z0-9_-]{16,}/g,MARK],
 [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,MARK],
 [/\bgithub_pat_[A-Za-z0-9_]{20,}/g,MARK],
 [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g,MARK],
 [/\bAKIA[0-9A-Z]{16}\b/g,MARK],
 [/\bAIza[0-9A-Za-z_-]{30,}/g,MARK],
 // "password": "value" and password: "value" keep their quotes; the value may contain spaces and escapes.
 [new RegExp(`(?<![A-Za-z0-9_])(${KEY})(["']?\\s*[:=]\\s*)"((?:[^"\\\\\\n]|\\\\.)*)"`,'gi'),(_,key,sep)=>`${key}${sep}"${MARK}"`],
 [new RegExp(`(?<![A-Za-z0-9_])(${KEY})(["']?\\s*[:=]\\s*)'([^'\\n]*)'`,'gi'),(_,key,sep)=>`${key}${sep}'${MARK}'`],
 [new RegExp(`(?<![A-Za-z0-9_])(${KEY})(["']?\\s*[:=]\\s*)(?!\\[redacted\\]|Bearer\\b|Basic\\b)([^\\s"',;&}\\])]{6,})`,'gi'),(_,key,sep)=>`${key}${sep}${MARK}`],
];
export const redact=text=>rules.reduce((value,[pattern,replacement])=>value.replace(pattern,replacement),String(text??''));

/** Streaming redaction: keeps the raw tail so a secret split across chunks is recognised once complete and its
 * first half is never emitted on its own. The returned text is always the redaction of the whole retained tail. */
export function createRedactor(limit=4000){
 let raw='';
 return {
  push(chunk){raw=(raw+String(chunk)).slice(-limit*2);return redact(raw).slice(-limit);},
  text(){return redact(raw).slice(-limit);},
 };
}
