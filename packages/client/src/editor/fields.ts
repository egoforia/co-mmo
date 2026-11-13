import { CREATURES, type EditContext, type EditField, type FieldChoice, type FieldValue } from '@co-mmo/shared';
import { escapeHtml } from '../ui.ts';
import { pictureFile } from './art-index.ts';

// A kind's settings as the editor draws and reads them: the making tools'
// forms and the inspector's sections both come from here. A field with a
// `when` rule is drawn only while it applies.

/** What the editor knows besides the land. */
export const CONTEXT: EditContext = { creatures: CREATURES };

/** Number settings with at most this many choices are drawn as a list to pick from. */
const SHORT_RANGE = 8;

/** A setting's starting value. */
export function start(f: EditField): FieldValue {
  if (f.type !== 'choice') return f.default;
  return f.default?.(CONTEXT) ?? f.choices(CONTEXT)[0]?.id ?? '';
}

/** Settings as chosen, the rest as they start, and a choice whose list changed (a wish switched off) back to its start. */
export function filled(fields: EditField[], chosen: Record<string, FieldValue>): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const f of fields) out[f.key] = f.key in chosen ? chosen[f.key]! : start(f);
  for (const f of fields) if (f.type === 'choice' && !f.choices(CONTEXT).some((c) => c.id === out[f.key])) out[f.key] = start(f);
  return out;
}

/** An input's value as its setting keeps it: a flag from its tick, a number kept in range, text cut to length. */
export function readField(field: EditField, raw: string, checked?: boolean): FieldValue {
  if (field.type === 'flag') return !!checked;
  if (field.type === 'number') return Math.max(field.min, Math.min(field.max, Math.round(Number(raw)) || field.min));
  if (field.type === 'text') return raw.slice(0, field.max);
  return raw;
}

/** A choice of a thing to place, as its picture and name on a button that opens the asset picker (`data-asset-field` names the setting). */
export function assetChoiceHtml(label: string, name: string, chosen: FieldChoice | undefined): string {
  const file = pictureFile(chosen?.art);
  const picture = file ? `<img src="${escapeHtml(file)}" alt="" />` : '<span class="unpainted">Not painted yet</span>';
  return `<label class="asset-field">${escapeHtml(label)} <button type="button" class="asset-choice" data-asset-field="${escapeHtml(name)}" title="Choose from the pictures">${picture}<span>${escapeHtml(chosen?.name ?? 'Choose…')}</span></button></label>`;
}

/** The choices of a setting, by its input's name in a kind's fields (with any prefix before the key). */
export function choicesOf(fields: EditField[], key: string): FieldChoice[] {
  const f = fields.find((x) => x.key === key);
  return f?.type === 'choice' ? f.choices(CONTEXT) : [];
}

/** True when changing one setting can show or hide another, so the form is drawn again. */
export function hasRules(fields: EditField[]): boolean {
  return fields.some((f) => f.when);
}

/** The settings that apply now as inputs, each named by `prefix` and its key. */
export function fieldsHtml(fields: EditField[], values: Record<string, FieldValue>, prefix = ''): string {
  const option = (value: string, label: string, chosen: boolean) => `<option value="${escapeHtml(value)}"${chosen ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  return fields.filter((f) => f.when?.(values) ?? true).map((f) => {
    const v = values[f.key];
    const name = `${prefix}${f.key}`;
    if (f.type === 'flag') return `<label class="check"><input type="checkbox" name="${name}"${v ? ' checked' : ''} /> ${escapeHtml(f.label)}</label>`;
    if (f.type === 'text') return `<label>${escapeHtml(f.label)} <input name="${name}" type="text" maxlength="${f.max}" value="${escapeHtml(String(v))}" /></label>`;
    if (f.type === 'choice') {
      const choices = f.choices(CONTEXT);
      // Things placed in the world are chosen from their pictures (asset-picker.ts).
      if (choices.some((c) => c.art)) return assetChoiceHtml(f.label, name, choices.find((c) => c.id === v));
      return `<label>${escapeHtml(f.label)} <select name="${name}">${choices.map((c) => option(c.id, c.name, c.id === v)).join('')}</select></label>`;
    }
    if (f.max - f.min <= SHORT_RANGE) {
      const counts = Array.from({ length: f.max - f.min + 1 }, (_, i) => f.min + i);
      return `<label>${escapeHtml(f.label)} <select name="${name}">${counts.map((n) => option(String(n), String(n), n === v)).join('')}</select></label>`;
    }
    return `<label>${escapeHtml(f.label)} <input name="${name}" type="number" min="${f.min}" max="${f.max}" value="${v}" /></label>`;
  }).join('\n');
}
