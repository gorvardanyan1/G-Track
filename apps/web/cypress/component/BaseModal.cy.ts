import { defineComponent, h, ref } from 'vue';
import BaseModal from '../../src/components/ui/BaseModal.vue';

/** A page with a button that opens the modal, like real usage (focus returns to it). */
const Host = defineComponent({
  setup() {
    const open = ref(false);
    return () => [
      h('button', { id: 'opener', onClick: () => (open.value = true) }, 'Open'),
      h(
        BaseModal,
        {
          open: open.value,
          'onUpdate:open': (v: boolean) => (open.value = v),
          title: 'Edit entry',
          description: 'Times are in Europe/Berlin.',
        },
        {
          default: () => [
            h('input', { id: 'first', 'aria-label': 'First' }),
            h('input', { id: 'second', 'aria-label': 'Second' }),
          ],
          footer: () => h('button', { id: 'save' }, 'Save'),
        },
      ),
    ];
  },
});

describe('BaseModal', () => {
  beforeEach(() => {
    cy.mount(Host);
    cy.get('#opener').click();
  });

  it('is an accessible dialog with title, description and footer', () => {
    cy.get('[role=dialog]')
      .should('have.attr', 'aria-modal', 'true')
      .and('have.attr', 'aria-label', 'Edit entry');
    cy.contains('h2', 'Edit entry');
    cy.contains('Times are in Europe/Berlin.');
    cy.get('#save').should('be.visible');
  });

  it('focuses the first field and locks page scrolling', () => {
    cy.get('#first').should('be.focused');
    cy.get('body').should('have.css', 'overflow', 'hidden');
  });

  it('closes with Escape and returns focus to the opener', () => {
    cy.get('#first').type('{esc}');
    cy.get('[role=dialog]').should('not.exist');
    cy.get('#opener').should('be.focused');
    cy.get('body').should('not.have.css', 'overflow', 'hidden');
  });

  it('closes from the close button', () => {
    cy.get('button[aria-label=Close]').click();
    cy.get('[role=dialog]').should('not.exist');
  });

  it('keeps Tab focus inside the dialog', () => {
    cy.get('#save').focus();
    cy.get('#save').trigger('keydown', { key: 'Tab' });
    cy.focused().then(($el) => {
      expect(Cypress.$('[role=dialog]').has($el[0]!).length || $el.is('[role=dialog]')).to.be.ok;
    });
  });
});
