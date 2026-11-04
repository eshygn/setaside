// Server half of the AG Studio agent. Studio (in the browser) sends one turn: instructions, the
// conversation so far and the JSON schemas of the tools it will execute. We call Gemini through
// the Vercel AI SDK with those tools declared (no `execute`, so the SDK only returns the calls)
// and hand back text and tool calls for Studio to run.
//
// Every live turn is recorded, keyed by the person's question and the round number, so a demo
// survives a spent free-tier quota: replayed turns are labelled "recorded" in the status chip.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { generateText, jsonSchema, tool, type ModelMessage, type ToolSet } from 'ai';
import { getDb } from '../db';
import { AiUnavailableError, setAiStatus, withModel } from './model';

export type AgentItem = {
  kind: 'input' | 'output';
  type: 'message' | 'function_call' | 'function_call_output' | 'reasoning';
  role?: string;
  content?: { type: string; text?: string }[];
  callId?: string;
  name?: string;
  arguments?: string;
  output?: string;
};

export type AgentTool = { name: string; description: string; parameters: Record<string, unknown>; kind?: string };

export type AgentTurnRequest = {
  instructions?: string;
  input: AgentItem[];
  tools: AgentTool[];
  toolChoice?: 'auto' | 'none' | 'required' | { name: string };
};

export type AgentTurn = {
  id: string;
  model: string;
  mode: 'live' | 'cached' | 'recorded' | 'offline';
  detail: string;
  text: string;
  toolCalls: { callId: string; name: string; arguments: string }[];
  usage?: { inputTokens?: number; outputTokens?: number };
};

// Gemini 3 needs each function call's thought signature echoed back on the next round. Studio's
// conversation items have nowhere to carry it, so we keep it here, keyed by call id.
const SIG_FALLBACK = 'skip_thought_signature_validator';

const textOf = (item: AgentItem) => (item.content ?? []).map((c) => c.text ?? '').join('');

/** Studio conversation items → AI SDK messages. */
export function toModelMessages(items: AgentItem[], signatures: (callId: string) => string | undefined): { system: string[]; messages: ModelMessage[] } {
  const system: string[] = [];
  const messages: ModelMessage[] = [];
  const names = new Map<string, string>();
  for (const item of items) {
    if (item.type === 'message' && item.kind === 'input') {
      if (item.role === 'system' || item.role === 'developer') system.push(textOf(item));
      else messages.push({ role: 'user', content: textOf(item) });
    } else if (item.type === 'message' && item.kind === 'output') {
      const text = textOf(item);
      if (text) messages.push({ role: 'assistant', content: [{ type: 'text', text }] });
    } else if (item.type === 'function_call' && item.callId && item.name) {
      names.set(item.callId, item.name);
      const part = {
        type: 'tool-call' as const,
        toolCallId: item.callId,
        toolName: item.name,
        input: safeJson(item.arguments),
        providerOptions: { google: { thoughtSignature: signatures(item.callId) ?? SIG_FALLBACK } },
      };
      const last = messages.at(-1);
      if (last?.role === 'assistant' && Array.isArray(last.content) && last.content.every((p) => p.type === 'tool-call')) last.content.push(part);
      else messages.push({ role: 'assistant', content: [part] });
    } else if (item.type === 'function_call_output' && item.callId) {
      const part = { type: 'tool-result' as const, toolCallId: item.callId, toolName: names.get(item.callId) ?? 'tool', output: { type: 'text' as const, value: item.output ?? '' } };
      const last = messages.at(-1);
      if (last?.role === 'tool') last.content.push(part);
      else messages.push({ role: 'tool', content: [part] });
    }
  }
  return { system, messages };
}

/** Make Studio's JSON Schema 2020-12 palatable to Gemini's function declarations. */
export function geminiSchema(schema: unknown): Record<string, unknown> {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === '$schema' || k === 'not') continue;
      if ((k === 'anyOf' || k === 'oneOf') && Array.isArray(v)) {
        // Shape encodes "optional" as anyOf [T, {not: {}}]; Gemini rejects `not`.
        const kept = v.filter((b) => !(b && typeof b === 'object' && 'not' in b && Object.keys(b).length === 1));
        if (kept.length === 1) Object.assign(out, walk(kept[0]));
        else out.anyOf = kept.map(walk);
        continue;
      }
      out[k] = walk(v);
    }
    return out;
  };
  const result = walk(schema) as Record<string, unknown>;
  return result.type ? result : { type: 'object', properties: {}, ...result };
}

function safeJson(s?: string): unknown {
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
}

// --- Recordings -------------------------------------------------------------------------------

const FIXTURE = path.join(process.cwd(), 'fixtures', 'ai', 'agent-turns.json');
type Recording = { text: string; toolCalls: { name: string; arguments: string }[]; model: string };

/** The person's latest question and how many model rounds have happened since. */
export function turnKey(items: AgentItem[]): { question: string; round: number; key: string } {
  let lastUser = -1;
  items.forEach((item, i) => {
    if (item.type === 'message' && item.kind === 'input' && item.role === 'user') lastUser = i;
  });
  const question = lastUser >= 0 ? textOf(items[lastUser]).trim() : '';
  const round = items.slice(lastUser + 1).filter((i) => i.type === 'function_call_output').length;
  const norm = question.toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();
  return { question, round, key: `${crypto.createHash('sha1').update(norm).digest('hex').slice(0, 16)}:${round}` };
}

function readFixture(): Record<string, Recording & { question: string }> {
  try {
    return JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  } catch {
    return {};
  }
}

function record(key: string, question: string, rec: Recording) {
  getDb().prepare('INSERT OR REPLACE INTO ai_cache (key, value, created_at) VALUES (?, ?, ?)').run(`agent:${key}`, JSON.stringify(rec), new Date().toISOString());
  if (process.env.RECORD_AGENT === '1') {
    const all = readFixture();
    all[key] = { question, ...rec };
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
    fs.writeFileSync(FIXTURE, JSON.stringify(all, null, 1));
  }
}

function recorded(key: string): Recording | undefined {
  const row = getDb().prepare('SELECT value FROM ai_cache WHERE key = ?').get(`agent:${key}`) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as Recording) : readFixture()[key];
}

// --- One turn --------------------------------------------------------------------------------------

export async function agentTurn(req: AgentTurnRequest): Promise<AgentTurn> {
  if (process.env.AGENT_DEBUG === '1') fs.writeFileSync(path.join(process.cwd(), 'data', 'agent-last-request.json'), JSON.stringify(req, null, 1));
  const id = `turn-${crypto.randomUUID().slice(0, 12)}`;
  const { question, key } = turnKey(req.input);
  const db = getDb();
  const sig = db.prepare('SELECT value FROM ai_cache WHERE key = ?');
  const { system, messages } = toModelMessages(req.input, (callId) => (sig.get(`sig:${callId}`) as { value: string } | undefined)?.value);
  const tools: ToolSet = Object.fromEntries(
    req.tools.filter((t) => t.kind !== 'provided').map((t) => [t.name, tool({ description: t.description, inputSchema: jsonSchema(geminiSchema(t.parameters)) })]),
  );
  const choice = req.toolChoice;
  const toolChoice = !choice || choice === 'auto' ? 'auto' : choice === 'none' || choice === 'required' ? choice : { type: 'tool' as const, toolName: choice.name };

  try {
    const { value, model } = await withModel(async (m) =>
      generateText({
        model: m,
        system: [req.instructions ?? '', ...system].filter(Boolean).join('\n\n'),
        messages,
        tools,
        toolChoice,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS ?? 75_000)),
        // Minimal thinking keeps free-tier rounds quick; the tools carry the hard parts.
        providerOptions: { google: { thinkingConfig: { thinkingLevel: 'minimal' } } },
      }),
    );
    const toolCalls = value.toolCalls.map((c) => {
      const signature = (c.providerMetadata as { google?: { thoughtSignature?: string } } | undefined)?.google?.thoughtSignature;
      if (signature) db.prepare('INSERT OR REPLACE INTO ai_cache (key, value, created_at) VALUES (?, ?, ?)').run(`sig:${c.toolCallId}`, signature, new Date().toISOString());
      return { callId: c.toolCallId, name: c.toolName, arguments: JSON.stringify(c.input ?? {}) };
    });
    record(key, question, { text: value.text, toolCalls: toolCalls.map(({ name, arguments: a }) => ({ name, arguments: a })), model });
    setAiStatus({ mode: 'live', model, detail: `Gemini (${model}) answering in the dashboard` });
    return { id, model, mode: 'live', detail: `Gemini ${model}`, text: value.text, toolCalls, usage: { inputTokens: value.usage.inputTokens, outputTokens: value.usage.outputTokens } };
  } catch (error) {
    const reason = error instanceof AiUnavailableError ? error.message : error instanceof Error ? error.message.slice(0, 160) : String(error);
    console.error('[agent] live turn failed:', error instanceof Error ? error.message.slice(0, 600) : error);
    const rec = recorded(key);
    if (rec) {
      setAiStatus({ mode: 'recorded', model: rec.model, detail: `Replaying a recorded Gemini answer: ${reason}` });
      return {
        id,
        model: rec.model,
        mode: 'recorded',
        detail: `Recorded answer (${reason})`,
        // Tool calls replay live, so widgets show current figures; the words were recorded earlier.
        text: rec.text ? `${rec.text}\n\n_(Recorded Gemini answer, replayed because ${reason.toLowerCase()}. The widgets show live figures.)_` : rec.text,
        toolCalls: rec.toolCalls.map((c, i) => ({ callId: `rec-${id}-${i}`, name: c.name, arguments: c.arguments })),
      };
    }
    setAiStatus({ mode: 'offline', detail: `Agent offline: ${reason}` });
    return {
      id,
      model: 'none',
      mode: 'offline',
      detail: reason,
      text: `I can’t reach Gemini right now (${reason}), and I have no recording for that question. The suggested questions above have recorded answers, so they work offline.`,
      toolCalls: [],
    };
  }
}
