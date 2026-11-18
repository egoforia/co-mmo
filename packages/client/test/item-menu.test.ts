import { describe, expect, it } from 'vitest';
import { useWord } from '../src/inventory/bag-html.ts';
import { itemMenuHtml } from '../src/inventory/item-menu.ts';

// The item menu's lines, and the word for each thing's main use.

describe('the item menu', () => {
  it('lists the actions, then a Split box that offers half', () => {
    const html = itemMenuHtml('Crab Shell', [{ label: 'Sort the bag', run() {} }], { qty: 9, run() {} });
    expect(html).toContain('Crab Shell');
    expect(html).toContain('data-entry="0">Sort the bag');
    expect(html).toContain('max="8" value="4"');
  });

  it('leaves Split out when there is nothing to split', () => {
    expect(itemMenuHtml('Wooden Sword', [{ label: 'Wear', run() {} }])).not.toContain('data-split');
  });

  it('names each thing by its main use', () => {
    expect(useWord('wooden-sword')).toBe('Wear');
    expect(useWord('bible')).toBe('Read');
    expect(useWord('crab-shell')).toBe('');
  });
});
