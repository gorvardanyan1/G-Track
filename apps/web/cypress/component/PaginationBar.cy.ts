import PaginationBar from '../../src/components/ui/PaginationBar.vue';

const mountAt = (modelValue: number, total = 95) => {
  cy.mount(PaginationBar, {
    props: {
      modelValue,
      total,
      pageSize: 20,
      noun: 'rows',
      'onUpdate:modelValue': cy.spy().as('page'),
    },
  });
};

describe('PaginationBar', () => {
  it('shows the range and disables Previous on the first page', () => {
    mountAt(1);
    cy.contains('1–20 of 95 rows');
    cy.contains('1 / 5');
    cy.get('button[aria-label="Previous page"]').should('be.disabled');
    cy.get('button[aria-label="Next page"]').click();
    cy.get('@page').should('have.been.calledOnceWith', 2);
  });

  it('shows a partial last page and disables Next there', () => {
    mountAt(5);
    cy.contains('81–95 of 95 rows');
    cy.get('button[aria-label="Next page"]').should('be.disabled');
    cy.get('button[aria-label="Previous page"]').click();
    cy.get('@page').should('have.been.calledOnceWith', 4);
  });

  it('handles an empty result', () => {
    mountAt(1, 0);
    cy.contains('0–0 of 0 rows');
    cy.contains('1 / 1');
  });
});
