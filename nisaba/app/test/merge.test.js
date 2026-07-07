import { describe, it, expect } from 'vitest';
import { resolveItem } from '../src/lib/merge.js';

const note = (over = {}) => ({
  id: 'x', type: 'note', title: 't', body: 'b', tags: [], deleted: false, updated_at: 100, ...over,
});

describe('resolveItem', () => {
  it('remote wins outright when local is clean', () => {
    const { winner, conflictCopy } = resolveItem(note({ title: 'remote' }), note({ title: 'local', dirty: 0 }));
    expect(winner.title).toBe('remote');
    expect(conflictCopy).toBeNull();
  });

  it('remote wins when there is no local copy', () => {
    const { winner } = resolveItem(note(), undefined);
    expect(winner.title).toBe('t');
  });

  it('newer local wins over older remote, loser becomes a conflict copy', () => {
    const remote = note({ title: 'remote-edit', updated_at: 100 });
    const local = note({ title: 'local-edit', updated_at: 200, dirty: 1 });
    const { winner, conflictCopy } = resolveItem(remote, local);
    expect(winner.title).toBe('local-edit');
    expect(conflictCopy.title).toBe('remote-edit (conflict copy)');
    expect(conflictCopy.id).not.toBe('x');
  });

  it('newer remote wins over older dirty local, local preserved as conflict copy', () => {
    const remote = note({ title: 'remote-edit', updated_at: 300 });
    const local = note({ title: 'local-edit', updated_at: 200, dirty: 1 });
    const { winner, conflictCopy } = resolveItem(remote, local);
    expect(winner.title).toBe('remote-edit');
    expect(conflictCopy.title).toBe('local-edit (conflict copy)');
  });

  it('no conflict copy when content is identical despite both changing', () => {
    const remote = note({ updated_at: 300 });
    const local = note({ updated_at: 200, dirty: 1 });
    expect(resolveItem(remote, local).conflictCopy).toBeNull();
  });

  it('tasks never produce conflict copies — newer just wins', () => {
    const remote = note({ type: 'task', title: 'remote', updated_at: 300 });
    const local = note({ type: 'task', title: 'local', updated_at: 200, dirty: 1 });
    const { winner, conflictCopy } = resolveItem(remote, local);
    expect(winner.title).toBe('remote');
    expect(conflictCopy).toBeNull();
  });

  it('deleting on one side while editing on the other keeps the newer action, no copy', () => {
    const remote = note({ deleted: true, updated_at: 300 });
    const local = note({ title: 'still editing', updated_at: 200, dirty: 1 });
    const { winner, conflictCopy } = resolveItem(remote, local);
    expect(winner.deleted).toBe(true);
    expect(conflictCopy).toBeNull();
  });

  it('equal timestamps converge on remote', () => {
    const { winner } = resolveItem(note({ title: 'remote' }), note({ title: 'local', dirty: 1 }));
    expect(winner.title).toBe('remote');
  });
});
