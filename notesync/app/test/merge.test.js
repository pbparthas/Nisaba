import { describe, it, expect } from 'vitest';
import { mergeItems } from '../src/lib/merge.js';

const item = (id, updated_at, title = '') => ({ id, updated_at, title, type: 'note' });

describe('mergeItems', () => {
  it('keeps items unique to each side', () => {
    const { merged } = mergeItems([item('r', 1)], [item('l', 2)]);
    expect(merged.map((i) => i.id).sort()).toEqual(['l', 'r']);
  });

  it('newer local wins over older remote', () => {
    const { merged, changedVsRemote } = mergeItems([item('x', 1, 'old')], [item('x', 2, 'new')]);
    expect(merged[0].title).toBe('new');
    expect(changedVsRemote).toBe(true);
  });

  it('newer remote wins over older local', () => {
    const { merged } = mergeItems([item('x', 5, 'remote')], [item('x', 2, 'local')]);
    expect(merged[0].title).toBe('remote');
  });

  it('remote wins ties so all devices converge', () => {
    const { merged } = mergeItems([item('x', 5, 'remote')], [item('x', 5, 'local')]);
    expect(merged[0].title).toBe('remote');
  });

  it('reports no change when local mirrors remote', () => {
    const { changedVsRemote } = mergeItems([item('x', 5)], [item('x', 5)]);
    expect(changedVsRemote).toBe(false);
  });

  it('tombstones merge like any other change', () => {
    const dead = { ...item('x', 9), deleted: true };
    const { merged } = mergeItems([item('x', 5)], [dead]);
    expect(merged[0].deleted).toBe(true);
  });
});
