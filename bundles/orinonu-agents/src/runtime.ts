import { Agent, Runner, tool, type AgentOutputType, type Model, type Tool } from "@openai/agents";
import { z } from "zod";

export type BoundAgentOptions<TOutput extends AgentOutputType = "text"> = {
  id: string;
  instructions: string;
  model: Model;
  tools?: Tool[];
  outputType?: TOutput;
};

export function createBoundAgent<TOutput extends AgentOutputType = "text">(options: BoundAgentOptions<TOutput>) {
  if (!options.model || typeof options.model !== "object" || typeof options.model.getResponse !== "function" || typeof options.model.getStreamedResponse !== "function") throw new Error("explicit_model_binding_required");
  return new Agent<unknown, TOutput>({ name: options.id, instructions: options.instructions, model: options.model, tools: options.tools, outputType: options.outputType });
}

export function createBoundRunner() {
  return new Runner({ tracingDisabled: true, traceIncludeSensitiveData: false });
}

export function createAdmittedDelegation(options: {
  parentId: string;
  child: Agent<unknown, "text">;
  admit: (order: { parentId: string; childId: string; input: string }) => Promise<boolean>;
}) {
  return tool({
    name: "delegate_" + options.child.name.replaceAll("-", "_"),
    description: "Delegate a bounded order to the assigned child after host admission.",
    parameters: z.object({ input: z.string().min(1).max(6000) }),
    errorFunction: null,
    execute: async ({ input }) => {
      if (await options.admit({ parentId: options.parentId, childId: options.child.name, input }) !== true) throw new Error("delegation_not_admitted");
      const result = await createBoundRunner().run(options.child, input, { maxTurns: 20 });
      if (result.interruptions.length) throw new Error("child_approval_required");
      if (result.finalOutput === undefined) throw new Error("child_result_incomplete");
      return result.finalOutput;
    },
  });
}
