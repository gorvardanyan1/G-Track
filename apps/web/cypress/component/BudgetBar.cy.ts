import BudgetBar from '../../src/components/manage/BudgetBar.vue';

describe('BudgetBar', () => {
  it('shows used vs budget and the share, in the calm tone below 80 %', () => {
    cy.mount(BudgetBar, { props: { usedSeconds: 36_000, budgetHours: 100 } });
    cy.contains('10 h');
    cy.contains('100 h');
    cy.contains('10%');
    cy.get('[role=progressbar]').should('have.attr', 'aria-valuenow', '10');
    cy.get('.bg-accent').should('exist');
  });

  it('turns amber from 80 % and red past 100 % (the bar stays full)', () => {
    cy.mount(BudgetBar, { props: { usedSeconds: 300_000, budgetHours: 100 } });
    cy.contains('83%').should('have.class', 'text-warning');
    cy.get('.bg-warning').should('exist');
    cy.mount(BudgetBar, { props: { usedSeconds: 400_000, budgetHours: 100 } });
    cy.contains('111%').should('have.class', 'text-danger');
    cy.get('.bg-danger').should('have.attr', 'style').and('contain', 'width: 100%');
  });

  it('works without a budget', () => {
    cy.mount(BudgetBar, { props: { usedSeconds: 7200, budgetHours: null } });
    cy.contains('no budget');
    cy.get('[role=progressbar]').should('have.attr', 'aria-label', 'No budget set');
  });
});
