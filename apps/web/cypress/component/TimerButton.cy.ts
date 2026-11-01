import TimerButton from '../../src/components/tracking/TimerButton.vue';

describe('TimerButton', () => {
  it('is a Start button with no rings while stopped', () => {
    cy.mount(TimerButton, { props: { running: false, onClick: cy.spy().as('click') } });
    cy.get('button')
      .should('have.attr', 'aria-label', 'Start timer (S)')
      .and('have.attr', 'aria-pressed', 'false');
    cy.get('.ring').should('not.exist');
    cy.get('button').click();
    cy.get('@click').should('have.been.calledOnce');
  });

  it('morphs into a Stop button with pulsing rings while running', () => {
    cy.mount(TimerButton, { props: { running: true } });
    cy.get('button')
      .should('have.attr', 'aria-label', 'Stop timer (S)')
      .and('have.attr', 'aria-pressed', 'true')
      .and('have.class', 'is-running');
    cy.get('.ring').should('have.length', 2);
  });

  it('is disabled while busy', () => {
    cy.mount(TimerButton, { props: { running: false, busy: true, onClick: cy.spy().as('click') } });
    cy.get('button').should('be.disabled');
  });
});
