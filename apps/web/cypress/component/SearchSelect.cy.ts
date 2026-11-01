import SearchSelect from '../../src/components/ui/SearchSelect.vue';

const options = [
  { value: 'fleet', label: 'Fleet Dashboard', group: 'Northwind', color: '#5B5BF7' },
  { value: 'route', label: 'Route Optimizer API', group: 'Northwind', color: '#10B981' },
  { value: 'care', label: 'Care Mobile App', group: 'Aurora Health', keywords: 'ios android' },
  { value: 'task', label: 'Design review', group: 'Aurora Health', indent: true },
];

function mountSelect(modelValue: string | null = null, extra: Record<string, unknown> = {}) {
  const onUpdate = cy.spy().as('update');
  cy.mount(SearchSelect, {
    props: {
      options,
      modelValue,
      label: 'Project',
      placeholder: 'Pick one',
      ...extra,
      'onUpdate:modelValue': onUpdate,
    },
  });
}

describe('SearchSelect', () => {
  it('shows the placeholder, then the selected label with its color', () => {
    mountSelect();
    cy.contains('button', 'Pick one').should('have.attr', 'aria-expanded', 'false');
    mountSelect('fleet');
    cy.contains('button', 'Fleet Dashboard');
  });

  it('opens a searchable list grouped under headers', () => {
    mountSelect();
    cy.contains('button', 'Pick one').click().should('have.attr', 'aria-expanded', 'true');
    cy.get('[role=combobox]').should('be.focused');
    cy.get('[role=option]').should('have.length', 4);
    cy.contains('[role=presentation]', 'Northwind');
    cy.contains('[role=presentation]', 'Aurora Health');
  });

  it('filters by label, group and keywords, and says when nothing matches', () => {
    mountSelect(null, { emptyText: 'No projects' });
    cy.contains('button', 'Pick one').click();
    cy.get('[role=combobox]').type('route');
    cy.get('[role=option]').should('have.length', 1).and('contain', 'Route Optimizer API');
    cy.get('[role=combobox]').clear().type('android');
    cy.get('[role=option]').should('have.length', 1).and('contain', 'Care Mobile App');
    cy.get('[role=combobox]').clear().type('aurora');
    cy.get('[role=option]').should('have.length', 2);
    cy.get('[role=combobox]').clear().type('zzz');
    cy.get('[role=option]').should('not.exist');
    cy.contains('No projects');
  });

  it('is fully keyboard driven: arrows wrap around, Enter chooses', () => {
    mountSelect();
    cy.contains('button', 'Pick one').click();
    cy.get('[role=combobox]').type('{downArrow}{downArrow}{enter}');
    cy.get('@update').should('have.been.calledOnceWith', 'care');
    cy.get('[role=listbox]').should('not.exist');
    cy.contains('button', 'Pick one').should('be.focused');

    cy.contains('button', 'Pick one').click();
    cy.get('[role=combobox]').type('{upArrow}{enter}');
    cy.get('@update').should('have.been.calledWith', 'task');
  });

  it('opens with the arrow key and starts on the selected option', () => {
    mountSelect('route');
    cy.contains('button', 'Route Optimizer API').focus().type('{downArrow}');
    cy.get('[role=option][aria-selected=true]').should('contain', 'Route Optimizer API');
    cy.get('[role=combobox]')
      .should('have.attr', 'aria-activedescendant')
      .and('match', /-opt-1$/);
  });

  it('closes with Escape or an outside click without choosing', () => {
    mountSelect();
    cy.contains('button', 'Pick one').click();
    cy.get('[role=combobox]').type('{esc}');
    cy.get('[role=listbox]').should('not.exist');
    cy.contains('button', 'Pick one').click();
    cy.get('body').trigger('pointerdown', 5, 5);
    cy.get('[role=listbox]').should('not.exist');
    cy.get('@update').should('not.have.been.called');
  });

  it('chooses with the mouse', () => {
    mountSelect();
    cy.contains('button', 'Pick one').click();
    cy.contains('[role=option]', 'Care Mobile App').click();
    cy.get('@update').should('have.been.calledOnceWith', 'care');
  });

  it('does nothing when disabled and shows errors as alerts', () => {
    mountSelect(null, { disabled: true, error: 'Choose a project' });
    cy.contains('button', 'Pick one').should('be.disabled');
    cy.get('[role=alert]').should('have.text', 'Choose a project');
    cy.contains('button', 'Pick one').should('have.attr', 'aria-invalid', 'true');
  });
});
