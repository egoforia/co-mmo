import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TilePoint, WorldEditDraft } from '@co-mmo/shared';
import type { AiServices } from './ai/services.ts';
import type { Budget } from './budget.ts';
import { json, readJson } from './http.ts';
import type { Account } from './store.ts';
import { planAiWorldEdits } from './world-edit-ai.ts';
import type { EditResult, WorldEditor } from './world-editor.ts';

// The world editor's API. Only the Owner and Stewards edit the world; every
// change is saved and can be taken back.
//   GET  /api/world-edits?region=<id>[&includeMap=1]   the land's edits, those that no longer fit (and map/palettes for Studio)
//   GET  /api/world-edits?region=<id>&export=1         the land's edits as a file any land can take
//   POST /api/world-edits            { region, edit }
//   POST /api/world-edits/undo       { region }
//   POST /api/world-edits/redo       { region }
//   POST /api/world-edits/remove     { region, id }
//   POST /api/world-edits/ai-preview { region, prompt, focus? }
//   POST /api/world-edits/ai-apply   { region, drafts }
//   POST /api/world-edits/import     { region, drafts }   a file's edits, those that fit
//   POST /api/world-edits/lands      { name, biome }      a new blank workshop land

/** Answers the world editor's routes; false when the request is not for them. */
export async function handleWorldEdits(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  account: Account | undefined,
  editor: WorldEditor,
  deps?: { ai?: AiServices; budget?: Budget },
): Promise<boolean> {
  if (url.pathname !== '/api/world-edits' && !url.pathname.startsWith('/api/world-edits/')) return false;
  if (!account) return json(res, 401, { error: 'unauthorized' }), true;
  if (account.suspended || account.role === 'player') return json(res, 403, { error: 'forbidden', message: 'Only the Owner and Stewards can edit the world.' }), true;
  const action = url.pathname.slice('/api/world-edits'.length).replace(/^\//, '');

  if (req.method === 'GET' && !action) {
    const region = url.searchParams.get('region') ?? '';
    if (url.searchParams.get('includeMap') === '1') {
      return json(res, 200, editor.inspectRegion(region || undefined)), true;
    }
    if (url.searchParams.get('export') === '1') {
      const file = editor.exportLand(region);
      return file ? json(res, 200, file) : json(res, 404, { error: 'not_found', message: 'There is no land by that name.' }), true;
    }
    const log = editor.log(region);
    return json(res, 200, { edits: log.edits, undone: log.undone.length, unlaid: editor.unlaid(region) }), true;
  }
  if (req.method !== 'POST') return json(res, 404, { error: 'not_found' }), true;
  const body = await readJson(req);
  const region = typeof body?.region === 'string' ? body.region : '';

  if (action === 'ai-preview') {
    const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt) return json(res, 400, { error: 'bad_request', message: 'Describe what you want the AI Map Architect to change.' }), true;
    const focus = Array.isArray(body?.focus) && body.focus.length === 2 ? ([Number(body.focus[0]), Number(body.focus[1])] as TilePoint) : undefined;
    const preview = await planAiWorldEdits({ regionId: region, prompt, focus, by: account.name, editor, ai: deps?.ai, budget: deps?.budget });
    return json(res, 200, { ok: true, ...preview }), true;
  }

  if (action === 'lands') {
    const made = editor.createLand(body?.name, body?.biome, account.name);
    return made.ok ? json(res, 200, made) : json(res, 400, { error: 'not_done', message: made.message }), true;
  }

  if (action === 'ai-apply' || action === 'import') {
    const drafts = Array.isArray(body?.drafts) ? (body.drafts as WorldEditDraft[]) : [];
    const applied = await editor.applyBatch(region, drafts, account.name);
    if (!applied.ok) return json(res, 400, { error: 'not_done', message: applied.message }), true;
    const inspected = editor.inspectRegion(region);
    return json(res, 200, { ok: true, applied: applied.applied, edits: applied.log.edits, undone: applied.log.undone.length, map: inspected.map }), true;
  }

  let result: EditResult;
  if (action === '' && body?.edit && typeof body.edit === 'object') result = await editor.add(region, body.edit as WorldEditDraft, account.name);
  else if (action === 'undo') result = await editor.undo(region);
  else if (action === 'redo') result = await editor.redo(region);
  else if (action === 'remove' && typeof body?.id === 'string') result = await editor.remove(region, body.id);
  else return json(res, 400, { error: 'bad_request', message: 'The editor did not understand that change.' }), true;
  if (!result.ok) return json(res, 400, { error: 'not_done', message: result.message }), true;
  return json(res, 200, { edits: result.log.edits, undone: result.log.undone.length, unlaid: editor.unlaid(region), map: editor.inspectRegion(region).map }), true;
}
