import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTracingDisabled } from "@openai/agents";
import manifest from "../package.json" with { type: "json" };

export { createAdmittedDelegation, createBoundAgent, createBoundRunner } from "./runtime.ts";

setTracingDisabled(true);

export function describeRuntime() {
  return {
    framework: "openai_agents_sdk",
    sdk_version: manifest.dependencies["@openai/agents"],
    protocol_version: 1,
    dispatch: "not_connected",
    authentication: "not_verified",
    activation: "opt_in_required",
    tracing: "disabled",
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv[2] === "--describe") process.stdout.write(JSON.stringify(describeRuntime()) + "\n");
  else { process.stderr.write("runtime_dispatch_not_connected\n"); process.exitCode = 2; }
}
