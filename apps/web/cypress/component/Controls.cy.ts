import SegmentedControl from '../../src/components/ui/SegmentedControl.vue';
import ToggleSwitch from '../../src/components/ui/ToggleSwitch.vue';

describe('ToggleSwitch', () => {
  it('is a switch that flips its value on click', () => {
    cy.mount(ToggleSwitch, {
      props: { modelValue: false, label: 'Billable', 'onUpdate:modelValue': cy.spy().as('update') },
    });
    cy.get('[role=switch]').should('have.attr', 'aria-checked', 'false').click();
    cy.get('@update').should('have.been.calledOnceWith', true);
  });

  it('can be disabled', () => {
    cy.mount(ToggleSwitch, { props: { modelValue: true, disabled: true } });
    cy.get('[role=switch]').should('be.disabled').and('have.attr', 'aria-checked', 'true');
  });
});

describe('SegmentedControl', () => {
  const options = [
    { value: 'week', label: 'This week' },
    { value: 'month', label: 'This month' },
  ];
  it('is a radio group that reports the chosen value', () => {
    cy.mount(SegmentedControl, {
      props: {
        options,
        label: 'Period',
        modelValue: 'week',
        'onUpdate:modelValue': cy.spy().as('update'),
      },
    });
    cy.get('[role=radiogroup]').should('have.attr', 'aria-label', 'Period');
    cy.contains('[role=radio]', 'This week').should('have.attr', 'aria-checked', 'true');
    cy.contains('[role=radio]', 'This month').should('have.attr', 'aria-checked', 'false').click();
    cy.get('@update').should('have.been.calledOnceWith', 'month');
  });
});
