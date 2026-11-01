import { h } from 'vue';
import DataTable from '../../src/components/ui/DataTable.vue';

const columns = [
  { key: 'name', label: 'Name' },
  { key: 'hours', label: 'Hours', align: 'right' as const },
];
const rows = [
  { id: 'a', name: 'Lena', hours: 7.5 },
  { id: 'b', name: 'Jonas', hours: 6 },
];
const slots = {
  name: ({ row }: { row: (typeof rows)[number] }) => h('span', row.name),
  hours: ({ row }: { row: (typeof rows)[number] }) => h('span', String(row.hours)),
  empty: () => h('p', { id: 'empty' }, 'Nothing here'),
};

describe('DataTable', () => {
  it('renders headers and one row per item through cell slots', () => {
    cy.mount(DataTable, { props: { columns, rows, rowKey: (r: { id: string }) => r.id }, slots });
    cy.get('th').should('have.length', 2).last().should('have.class', 'text-right');
    cy.get('tbody tr')
      .should('have.length', 2)
      .first()
      .should('contain', 'Lena')
      .and('contain', '7.5');
    cy.get('#empty').should('not.exist');
  });

  it('shows skeleton rows while loading', () => {
    cy.mount(DataTable, {
      props: { columns, rows: [], rowKey: (r: { id: string }) => r.id, loading: true },
      slots,
    });
    cy.get('tbody tr').should('have.length', 4);
    cy.get('.skeleton').should('have.length', 8);
    cy.get('#empty').should('not.exist');
  });

  it('replaces the table head with the empty state when there are no rows', () => {
    cy.mount(DataTable, {
      props: { columns, rows: [], rowKey: (r: { id: string }) => r.id },
      slots,
    });
    cy.get('thead').should('not.exist');
    cy.get('#empty').should('have.text', 'Nothing here');
  });
});
