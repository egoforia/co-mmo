import { describe, expect, it } from 'vitest';
import { referencesHtml } from '../src/art-ui/dialogs.ts';
import { artState, type Review, type WalkerView, type ArtItem } from '../src/art-ui/state.ts';

describe('review references UI', () => {
  it('renders reference chips, game art selector with optgroups, and upload/link controls', () => {
    artState.data = {
      walkers: [
        { id: 'sanctum-pilgrim', name: 'Sister Amala', kind: 'person', url: '/art/sanctum-pilgrim.png' } as unknown as WalkerView,
        { id: 'sylvan-cervid', name: 'Sylvan Cervid', kind: 'creature', url: '/art/sylvan-cervid.png' } as unknown as WalkerView,
        { id: 'bramble-bear', name: 'Bramble Bear', kind: 'creature', url: '/art/bramble-bear.png' } as unknown as WalkerView,
      ],
      items: [
        { id: 'item-wooden-sword', name: 'Wooden Sword', url: '/art/item-wooden-sword.png' } as unknown as ArtItem,
      ],
    } as unknown as typeof artState.data;

    const review: Review = {
      title: 'Paint Sister Amala again',
      parts: [],
      estimateUsd: 0.04,
      fingerprint: 'fp-123',
      references: [
        { id: 'sanctum-pilgrim', name: 'Sister Amala', url: '/art/sanctum-pilgrim.png' },
      ],
    };

    const html = referencesHtml(review);

    // Shows currently selected reference chip with remove button
    expect(html).toContain('Sister Amala');
    expect(html).toContain('data-remove-ref="sanctum-pilgrim"');
    expect(html).toContain('src="/art/sanctum-pilgrim.png"');

    // Dropdown contains unselected options (like Sylvan Cervid) and omits already selected ones
    expect(html).toContain('value="sylvan-cervid">Sylvan Cervid</option>');
    expect(html).toContain('value="bramble-bear">Bramble Bear</option>');
    expect(html).toContain('value="item-wooden-sword">Wooden Sword</option>');
    expect(html).not.toContain('value="sanctum-pilgrim"');

    // Controls for upload and URL link
    expect(html).toContain('class="ref-file-input"');
    expect(html).toContain('class="ref-url-input"');
    expect(html).toContain('ref-url-submit');
  });

  it('renders version dropdown on reference chip and in game art picker when versions exist', () => {
    artState.data = {
      walkers: [
        { id: 'sylvan-cervid', name: 'Sylvan Cervid', kind: 'creature', url: '/wished-art/redone/sylvan-cervid.png' } as unknown as WalkerView,
      ],
      items: [
        {
          id: 'sylvan-cervid',
          name: 'Sylvan Cervid',
          url: '/wished-art/redone/sylvan-cervid.png',
          source: 'redone',
          versions: [{ id: 'v2', url: '/wished-art/history/sylvan-cervid/v2.png' }],
          shipped: { url: '/art/sylvan-cervid.png' },
        } as unknown as ArtItem,
      ],
    } as unknown as typeof artState.data;

    const review: Review = {
      title: 'Paint Sister Amala again',
      parts: [],
      estimateUsd: 0.04,
      fingerprint: 'fp-123',
      references: [
        {
          id: 'sanctum-pilgrim@v1',
          assetId: 'sanctum-pilgrim',
          versionId: 'v1',
          name: 'Sister Amala (v1)',
          url: '/wished-art/history/sanctum-pilgrim/v1.png',
          availableVersions: [
            { id: 'current', label: 'Current version', url: '/wished-art/redone/sanctum-pilgrim.png' },
            { id: 'v1', label: 'Earlier (Oct 24)', url: '/wished-art/history/sanctum-pilgrim/v1.png' },
            { id: 'shipped', label: 'Original shipped version', url: '/art/sanctum-pilgrim.png' },
          ],
        },
      ],
    };

    const html = referencesHtml(review);

    // Chip renders version select with selected version
    expect(html).toContain('class="ref-version-select"');
    expect(html).toContain('value="v1" selected');
    expect(html).toContain('Earlier (Oct 24)');
    expect(html).toContain('Original shipped version');

    // Picker lists sub-options for earlier versions and shipped version
    expect(html).toContain('value="sylvan-cervid">Sylvan Cervid (Current)</option>');
    expect(html).toContain('value="sylvan-cervid@v2">  ↳ Sylvan Cervid (Earlier: v2)</option>');
    expect(html).toContain('value="sylvan-cervid@shipped">  ↳ Sylvan Cervid (Original Shipped)</option>');
  });
});
