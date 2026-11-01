import ConfirmDialog from '../../src/components/ui/ConfirmDialog.vue';

describe('ConfirmDialog', () => {
  it('confirms or cancels', () => {
    cy.mount(ConfirmDialog, {
      props: {
        open: true,
        title: 'Delete this entry?',
        confirmLabel: 'Delete',
        tone: 'danger',
        onConfirm: cy.spy().as('confirm'),
        'onUpdate:open': cy.spy().as('open'),
      },
      slots: { default: () => 'It can’t be undone.' },
    });
    cy.get('[role=dialog]').should('contain', 'It can’t be undone.');
    cy.contains('button', 'Delete').click();
    cy.get('@confirm').should('have.been.calledOnce');
    cy.contains('button', 'Cancel').click();
    cy.get('@open').should('have.been.calledWith', false);
  });

  it('shows progress while confirming', () => {
    cy.mount(ConfirmDialog, { props: { open: true, title: 'Archive?', loading: true } });
    cy.contains('button', 'Confirm').should('have.attr', 'aria-busy', 'true');
  });
});
