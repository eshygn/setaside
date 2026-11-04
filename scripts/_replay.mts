import fs from 'node:fs';
import { agentTurn } from '../lib/ai/agent';
const req = JSON.parse(fs.readFileSync('data/agent-last-request.json', 'utf8'));
console.log('tools', req.tools.map((t: any) => `${t.name}:${JSON.stringify(t.parameters).length}`).join(' '));
console.log('instructions', (req.instructions ?? '').length, 'input items', req.input.length);
const t0 = Date.now();
const r = await agentTurn(req);
console.log(Date.now() - t0, 'ms', r.mode, r.model, r.text.slice(0, 300), JSON.stringify(r.toolCalls).slice(0, 1500));
