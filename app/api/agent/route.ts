import { agentTurn, type AgentTurnRequest } from '@/lib/ai/agent';
import { body, failure, json } from '../_util';

// One round of the AG Studio agent (see app/studio/gemini-adapter.ts). Studio sends its
// instructions, conversation and tool schemas; Gemini answers with text and tool calls, which
// Studio then executes in the browser. The Gemini key never leaves the server.
export async function POST(request: Request) {
  const req = await body<AgentTurnRequest>(request);
  if (!Array.isArray(req.input) || !Array.isArray(req.tools)) return json({ error: 'input and tools are required' }, 400);
  try {
    return json(await agentTurn(req as AgentTurnRequest));
  } catch (error) {
    return failure(error, 500);
  }
}
