import WorkingNowList from '../../src/components/manage/WorkingNowList.vue';
import { useClockStore } from '../../src/stores/clock.ts';

/** A fixed instant just past a second boundary, so the clock's ticks are predictable. */
const NOW = Date.parse('2026-11-01T11:00:00.100Z');
const startedAt = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString();
const item = (name: string, secondsAgo: number, extra = {}) => ({
  user: { id: `0190e5b2-0000-7000-8000-00000000000${name.length}`, name },
  entry: {
    id: `0190e5b2-0000-7000-8000-0000000000a${name.length}`,
    project: {
      id: '0190e5b2-0000-7000-8000-0000000000f1',
      name: 'Fleet Dashboard',
      color: '#5B5BF7',
    },
    task: { id: '0190e5b2-0000-7000-8000-0000000000e1', name: 'Live map' },
    description: 'Clustering',
    isBillable: true,
    startedAt: startedAt(secondsAgo),
    ...extra,
  },
});

describe('WorkingNowList', () => {
  it('lists who is tracking, on what, with time that ticks on the second', () => {
    cy.clock(NOW, ['Date', 'setTimeout', 'clearTimeout']);
    cy.mount(WorkingNowList, {
      props: { items: [item('Lena', 3725)], zone: 'Europe/Berlin' },
    }).then(() => useClockStore().start());
    cy.contains('Lena');
    cy.contains('Fleet Dashboard · Live map — Clustering');
    cy.contains('since 10:57'); // 09:57:55 UTC in Berlin (CET)
    cy.contains('01:02:05');
    // Ticks land just after each second boundary (here +0.905 s, +1.905 s, …).
    cy.tick(1000);
    cy.contains('01:02:05');
    cy.tick(1000);
    cy.contains('01:02:06');
    cy.tick(2000);
    cy.contains('01:02:08');
  });

  it('shows skeletons while loading and a calm empty state', () => {
    cy.mount(WorkingNowList, { props: { items: [], zone: 'UTC', loading: true } });
    cy.get('.skeleton').should('exist');
    cy.mount(WorkingNowList, { props: { items: [], zone: 'UTC' } });
    cy.contains('Nobody is tracking right now.');
  });
});
