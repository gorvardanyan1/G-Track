import PasswordChecklist from '../../src/components/auth/PasswordChecklist.vue';

const ok = (text: RegExp) => cy.contains('li', text).should('have.class', 'text-running');
const notOk = (text: RegExp) => cy.contains('li', text).should('not.have.class', 'text-running');

describe('PasswordChecklist', () => {
  it('shows every rule as pending for an empty password', () => {
    cy.mount(PasswordChecklist, { props: { password: '' } });
    cy.get('li')
      .should('have.length', 4)
      .each(($li) => expect($li).not.to.have.class('text-running'));
  });

  it('ticks rules as a strong password satisfies them', () => {
    cy.mount(PasswordChecklist, {
      props: { password: 'violet tram under the rain', email: 'nare@tempo.test', name: 'Nare' },
    });
    cy.get('li.text-running').should('have.length', 4);
  });

  it('flags short, common, personal and repeated passwords', () => {
    cy.mount(PasswordChecklist, { props: { password: 'short' } });
    notOk(/characters/);
    cy.mount(PasswordChecklist, { props: { password: 'password1234' } });
    notOk(/common/i);
    cy.mount(PasswordChecklist, {
      props: { password: 'anahit-secret-2026', name: 'Anahit Petrosyan' },
    });
    notOk(/name|email|personal/i);
    cy.mount(PasswordChecklist, { props: { password: 'aaaaaaaaaaaaaaaa' } });
    notOk(/same character/i);
    ok(/characters/);
  });
});
