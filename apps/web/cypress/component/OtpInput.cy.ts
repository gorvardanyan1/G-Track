import OtpInput from '../../src/components/auth/OtpInput.vue';

describe('OtpInput', () => {
  beforeEach(() => {
    cy.mount(OtpInput, { props: { onComplete: cy.spy().as('complete') } });
  });

  it('has six labelled boxes and starts focused on the first', () => {
    cy.get('[role=group][aria-label="6-digit code"] input').should('have.length', 6);
    cy.get('input[aria-label="Digit 1"]').should('be.focused');
  });

  it('moves along while typing and emits the full code once', () => {
    for (const [i, d] of [...'482910'].entries())
      cy.get(`input[aria-label="Digit ${i + 1}"]`).type(d);
    cy.get('@complete').should('have.been.calledOnceWith', '482910');
  });

  it('spreads a pasted code (spaces and dashes ignored)', () => {
    cy.get('input[aria-label="Digit 1"]').trigger('paste', {
      clipboardData: { getData: () => '123 - 456' },
    });
    cy.get('@complete').should('have.been.calledOnceWith', '123456');
    cy.get('input[aria-label="Digit 6"]').should('have.value', '6');
  });

  it('ignores letters', () => {
    cy.get('input[aria-label="Digit 1"]').type('a');
    cy.get('input[aria-label="Digit 1"]').should('have.value', '');
  });

  it('Backspace on an empty box goes back one', () => {
    cy.get('input[aria-label="Digit 1"]').type('7');
    cy.get('input[aria-label="Digit 2"]').should('be.focused').type('{backspace}');
    cy.get('input[aria-label="Digit 1"]').should('be.focused');
  });
});
