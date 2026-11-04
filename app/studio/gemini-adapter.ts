'use client';

// AG Studio AgLlmAdapter for Gemini. Studio's Direct LLM Runner calls executeTurn once per round;
// we post the turn (instructions, conversation, tool schemas) to /api/agent, which calls Gemini
// through the Vercel AI SDK with the server-side key, then translate its answer into the AG-UI
// events and final response Studio reads. The adapter never executes tools: Studio does.
// Modelled on the OpenAI adapter from the AG Studio docs that the boilerplate ships.

import type { AgAiEvent, AgAiOutputItem, AgLlmAdapter, AgLlmRequest, AgLlmResponse, AgLlmResponseHandler } from 'ag-studio';

export type AgentTurnResponse = {
  id: string;
  model: string;
  mode: 'live' | 'cached' | 'recorded' | 'offline';
  detail: string;
  text: string;
  toolCalls: { callId: string; name: string; arguments: string }[];
  usage?: { inputTokens?: number; outputTokens?: number };
};

export type AgentModeListener = (mode: AgentTurnResponse['mode'], detail: string, model: string) => void;

export function geminiAdapter(options: { endpoint: string; onMode?: AgentModeListener }): AgLlmAdapter {
  return {
    executeTurn: (request: AgLlmRequest, opts?: { signal?: AbortSignal }): AgLlmResponseHandler => {
      let resolve!: (r: AgLlmResponse) => void;
      let reject!: (e: Error) => void;
      const complete = new Promise<AgLlmResponse>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      void complete.catch(() => {});

      async function* run(): AsyncIterableIterator<AgAiEvent> {
        let turn: AgentTurnResponse;
        try {
          const res = await fetch(options.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              instructions: request.instructions,
              input: request.input,
              tools: request.tools ?? [],
              toolChoice: request.toolChoice,
            }),
            signal: opts?.signal,
          });
          const body = await res.json();
          if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
          turn = body as AgentTurnResponse;
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        options.onMode?.(turn.mode, turn.detail, turn.model);

        const output: AgAiOutputItem[] = [];
        if (turn.text) {
          const messageId = `${turn.id}-msg`;
          yield { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' };
          // Stream in small pieces so the panel types it out rather than dropping a block.
          for (const chunk of turn.text.match(/[\s\S]{1,24}/g) ?? []) {
            yield { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: chunk };
            await new Promise((r) => setTimeout(r, 8));
          }
          yield { type: 'TEXT_MESSAGE_END', messageId };
          output.push({ id: messageId, kind: 'output', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'text', text: turn.text, annotations: [] }] });
        }
        for (const call of turn.toolCalls) {
          yield { type: 'TOOL_CALL_START', toolCallId: call.callId, toolCallName: call.name };
          yield { type: 'TOOL_CALL_ARGS', toolCallId: call.callId, delta: call.arguments };
          yield { type: 'TOOL_CALL_END', toolCallId: call.callId };
          output.push({ id: call.callId, kind: 'output', type: 'function_call', callId: call.callId, name: call.name, arguments: call.arguments, status: 'completed' });
        }
        resolve({
          id: turn.id,
          createdAt: Date.now(),
          model: turn.model,
          status: 'completed',
          output,
          usage: turn.usage?.inputTokens !== undefined ? { inputTokens: turn.usage.inputTokens ?? 0, outputTokens: turn.usage.outputTokens ?? 0, totalTokens: (turn.usage.inputTokens ?? 0) + (turn.usage.outputTokens ?? 0) } : undefined,
        });
      }

      const iterator = run();
      return { stream: { [Symbol.asyncIterator]: () => iterator }, complete };
    },
  };
}
