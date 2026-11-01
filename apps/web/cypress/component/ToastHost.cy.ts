import ToastHost from '../../src/components/ui/ToastHost.vue';
import { useToastStore } from '../../src/stores/toasts.ts';

describe('ToastHost', () => {
  it('shows toasts with the right roles and lets people dismiss them', () => {
    cy.mount(ToastHost).then(() => {
      const toasts = useToastStore();
      toasts.success('Timesheet approved', 'Week of 19 Oct');
      toasts.error(new Error('boom'), 'Could not save');
    });
    cy.get('[role=status]')
      .should('contain', 'Timesheet approved')
      .and('contain', 'Week of 19 Oct');
    cy.get('[role=alert]').should('contain', 'Could not save');
    cy.get('[role=status]').find('button[aria-label=Dismiss]').click();
    cy.contains('Timesheet approved').should('not.exist');
  });
});
