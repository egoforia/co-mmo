import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WorldEditDraft } from '@co-mmo/shared';
import { json, readJson } from './http.ts';
import type { Account } from './store.ts';
import type { EditResult, WorldEditor } from './world-editor.ts';

// The world editor's API. Only the Owner and Stewards edit the world; every
// change is saved and can be taken back.
//   GET  /api/world-edits?region=<id>        the land's edits, newest last
//   POST /api/world-edits        { region, edit }
//   POST /api/world-edits/undo   { region }
//   POST /api/world-edits/redo   { region }
//   POST /api/world-edits/remove { region, id }

/** Answers the world editor's routes; false when the request is not for them. */
export async function handleWorldEdits(req: IncomingMessage, res: ServerResponse, url: URL, account: Account | undefined, editor: WorldEditor): Promise<boolean> {
  if (url.pathname !== '/api/world-edits' && !url.pathname.startsWith('/api/world-edits/')) return false;
  if (!account) return json(res, 401, { error: 'unauthorized' }), true;
  if (account.suspended || account.role === 'player') return json(res, 403, { error: 'forbidden', message: 'Only the Owner and Stewards can edit the world.' }), true;
  const action = url.pathname.slice('/api/world-edits'.length).replace(/^\//, '');

  if (req.method === 'GET' && !action) {
    const region = url.searchParams.get('region') ?? '';
    const log = editor.log(region);
    return json(res, 200, { edits: log.edits, undone: log.undone.length }), true;
  }
  if (req.method !== 'POST') return json(res, 404, { error: 'not_found' }), true;
  const body = await readJson(req);
  const region = typeof body?.region === 'string' ? body.region : '';
  let result: EditResult;
  if (action === '' && body?.edit && typeof body.edit === 'object') result = await editor.add(region, body.edit as WorldEditDraft, account.name);
  else if (action === 'undo') result = await editor.undo(region);
  else if (action === 'redo') result = await editor.redo(region);
  else if (action === 'remove' && typeof body?.id === 'string') result = await editor.remove(region, body.id);
  else return json(res, 400, { error: 'bad_request', message: 'The editor did not understand that change.' }), true;
  if (!result.ok) return json(res, 400, { error: 'not_done', message: result.message }), true;
  return json(res, 200, { edits: result.log.edits, undone: result.log.undone.length }), true;
}
