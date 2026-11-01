import AuditDiff from '../../src/components/admin/AuditDiff.vue';

describe('AuditDiff', () => {
  it('marks changed, added, removed and unchanged fields, changes first', () => {
    cy.mount(AuditDiff, {
      props: {
        before: { name: 'TEMPO', lockAfterDays: 30, rounding: { minutes: 15 } },
        after: { name: 'TEMPO Studio', rounding: { minutes: 15 }, timesheetApprovalEnabled: true },
      },
    });
    cy.get('tbody tr').should('have.length', 4);
    cy.get('tbody tr')
      .eq(0)
      .should('contain', 'name')
      .and('contain', 'TEMPO Studio')
      .and('contain', '~');
    cy.get('tbody tr').eq(1).should('contain', 'timesheetApprovalEnabled').and('contain', '+');
    cy.get('tbody tr').eq(2).should('contain', 'lockAfterDays').and('contain', '−');
    cy.get('tbody tr').eq(3).should('contain', 'rounding.minutes');
  });

  it('says so when an event has no snapshot', () => {
    cy.mount(AuditDiff, { props: { before: null, after: null } });
    cy.contains('This event recorded no data snapshot.');
  });
});
