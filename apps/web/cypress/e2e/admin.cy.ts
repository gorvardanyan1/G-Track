import { PASSWORD } from '../support/constants.ts';
import type { ClonedUser } from '../tasks.ts';

/** A fresh Super Admin (with 2FA, as required) signed in through the UI. */
function asAdmin(): Cypress.Chainable<ClonedUser> {
  return cy.cloneUser('admin@tempo.test', { totp: true }).then((admin) => {
    cy.login(admin);
    return cy.wrap(admin);
  });
}
/** The user's row on the Users page (searched, since the list is paged). */
function userRow(user: { email: string; name: string }) {
  cy.visit('/users');
  cy.get('input[aria-label="Search users"]').clear().type(user.email);
  cy.get('tbody tr').should('have.length', 1);
  return cy.contains('tr', user.name);
}
const lastAudit = (action: string, targetId: string) =>
  cy.task<{ before: unknown; after: unknown }[]>('db:query', {
    text: `SELECT before, after FROM audit_logs WHERE action = $1 AND target_id = $2
           ORDER BY created_at DESC LIMIT 1`,
    values: [action, targetId],
  });

describe('user administration', () => {
  it('invites someone who accepts, signs in, and is no longer pending', () => {
    asAdmin().then(() => {
      const email = `cy.invite.${Date.now()}@tempo.test`;
      cy.visit('/users');
      cy.contains('button', 'Invite').click();
      cy.get('[role=dialog]').within(() => {
        cy.findField('Email').type(email);
        cy.contains('[role=radio]', 'Project manager').click();
        cy.contains('button', 'Send invitation').click();
      });
      cy.contains('section', 'Pending invitations')
        .should('contain', email)
        .and('contain', 'Project manager');

      cy.latestMail(email).then((mail) => {
        const link = /https?:\/\/\S+/.exec(mail.text)?.[0] ?? '';
        expect(link).to.contain('/accept-invite#token=');
        cy.clearAllCookies();
        cy.visit(link.replace(/^https?:\/\/[^/]+/, ''));
      });
      cy.contains(email);
      cy.findField('Your name').type('Nare Hakobyan');
      const password = 'copper kite over sevan lake';
      cy.findField('Password').type(password);
      cy.get('li.text-running').should('have.length', 4);
      cy.contains('button', 'Create account').click();
      cy.location('pathname').should('eq', '/today');
      // Invited as PM: the Manage menu is there.
      cy.get('nav').should('contain', 'Approvals');

      // The token is single-use.
      cy.latestMail(email).then((mail) => {
        const token = /#token=([\w-]+)/.exec(mail.text)?.[1];
        cy.api('POST', '/auth/invites/inspect', { body: { token } })
          .its('status')
          .should('eq', 400);
      });
    });
  });

  it('changes a role; the person gets the new menu at their next page load', () => {
    cy.cloneUser('ethan.brooks@tempo.test').then((worker) =>
      asAdmin().then(() => {
        userRow(worker).find('button[aria-label="Change role"]').click();
        cy.get('[role=dialog]').within(() => {
          cy.contains('[role=radio]', 'Project manager').click();
          cy.contains('button', 'Save').click();
        });
        cy.contains('tr', worker.name).should('contain', 'Project manager');
        lastAudit('user.role_changed', worker.id)
          .its('0')
          .should('deep.include', {
            before: { role: 'WORKER' },
            after: { role: 'PROJECT_MANAGER' },
          });

        cy.clearAllCookies();
        cy.login(worker);
        cy.get('nav').should('contain', 'Dashboard').and('contain', 'Approvals');
      }),
    );
  });

  it('deactivating ends sessions at once and blocks sign-in; reactivating restores it', () => {
    cy.cloneUser('ethan.brooks@tempo.test').then((worker) =>
      cy.apiLogin(worker).then((workerToken) =>
        asAdmin().then(() => {
          userRow(worker).find('button[aria-label=Deactivate]').click();
          cy.get('[role=dialog]').contains('button', 'Deactivate').click();
          cy.contains('tr', worker.name).should('contain', 'Deactivated');
          cy.api('GET', '/auth/me', { token: workerToken }).its('status').should('eq', 401);
          cy.api<{ error: { code: string } }>('POST', '/auth/login', {
            body: { email: worker.email, password: PASSWORD },
          }).then((res) => {
            expect(res.status).to.eq(403);
            expect(res.body.error.code).to.eq('ACCOUNT_DISABLED');
          });
          lastAudit('user.deactivated', worker.id).should('have.length', 1);

          cy.contains('tr', worker.name).find('button[aria-label=Reactivate]').click();
          cy.get('[role=dialog]').contains('button', 'Reactivate').click();
          cy.contains('tr', worker.name).should('not.contain', 'Deactivated');
          cy.apiLogin(worker).should('be.a', 'string');
        }),
      ),
    );
  });

  it('tells a deactivated person why they can’t sign in', () => {
    cy.cloneUser('ethan.brooks@tempo.test').then((worker) =>
      cy.cloneUser('admin@tempo.test', { totp: true }).then((admin) =>
        cy.apiLogin(admin).then((adminToken) => {
          cy.api('POST', `/users/${worker.id}/deactivate`, { token: adminToken })
            .its('status')
            .should('eq', 200);
          cy.visit('/login');
          cy.findField('Email').type(worker.email);
          cy.get('#password').type(PASSWORD);
          cy.contains('button', 'Sign in').click();
          cy.get('[role=alert]').should('contain', 'This account has been deactivated.');
          cy.location('pathname').should('eq', '/login');
        }),
      ),
    );
  });

  it('“sign out everywhere” ends a person’s sessions but keeps the account', () => {
    cy.cloneUser('ethan.brooks@tempo.test').then((worker) =>
      cy.apiLogin(worker).then((workerToken) =>
        asAdmin().then(() => {
          userRow(worker).find('button[aria-label="Sign out everywhere"]').click();
          cy.get('[role=dialog]').contains('button', 'Sign out').click();
          cy.contains('[role=status]', 'Signed out everywhere');
          cy.api('GET', '/auth/me', { token: workerToken }).its('status').should('eq', 401);
          cy.apiLogin(worker).should('be.a', 'string');
        }),
      ),
    );
  });

  it('admins can’t change, deactivate or sign out themselves from the list', () => {
    asAdmin().then((admin) => {
      userRow(admin).within(() => {
        cy.contains('(you)');
        cy.get('button').should('not.exist');
      });
    });
  });
});

describe('clients, projects and PM assignment', () => {
  it('creates a client and a budgeted project, assigns a PM who then sees it', () => {
    cy.cloneUser('marcus.reed@tempo.test', { memberships: false }).then((pm) =>
      asAdmin().then(() => {
        const client = `Cy Client ${Date.now() % 100000}`;
        const project = `${client} Portal`;
        cy.visit('/clients');
        cy.contains('button', 'New client').click();
        cy.get('[role=dialog]').within(() => {
          cy.findField('Name').type(client);
          cy.contains('button', 'Add client').click();
        });
        cy.contains('section', client).contains('button', 'Project').click();
        cy.get('[role=dialog]').within(() => {
          cy.findField('Name').type(project);
          cy.findField('Client').should('contain', client);
          cy.findField('Budget (hours)').type('120');
          cy.contains('button', 'Create project').click();
        });
        cy.contains('section', client).contains('a', project).should('contain', '120 h').click();

        cy.contains('h1', project);
        cy.contains('button', 'Add member').click();
        cy.get('[role=dialog]').within(() => {
          cy.contains('[role=radio]', 'Project manager').click();
          cy.contains('button', 'Choose someone').click();
        });
        cy.get('[role=combobox]').type(pm.name);
        cy.contains('[role=option]', pm.name).click();
        cy.get('[role=dialog]').contains('button', /^Add$/).click();
        cy.contains('tr', pm.name).should('contain', 'Project manager');

        cy.clearAllCookies();
        cy.login(pm);
        cy.visit('/projects');
        cy.contains(project).click();
        cy.contains('h1', project);
        cy.contains('button', 'Edit budget');
        cy.contains('button', 'Archive').should('not.exist');
      }),
    );
  });
});

describe('organization settings and the audit log', () => {
  it('saves only what changed and shows it as a before/after diff', () => {
    asAdmin().then((admin) => {
      cy.visit('/settings');
      cy.findField('Organization name')
        .invoke('val')
        .then((original) => {
          const renamed = `TEMPO Cy ${Date.now() % 10000}`;
          cy.findField('Organization name').clear().type(renamed);
          cy.contains('Unsaved changes');
          cy.contains('button', 'Save changes').click();
          cy.contains('[role=status]', 'Settings saved');
          cy.contains(`by ${admin.name}`);

          cy.visit('/audit-log');
          cy.contains('tr', 'Settings updated').first().contains('button', 'Changes').click();
          cy.get('[role=dialog]').within(() => {
            cy.contains('tr', 'name').should('contain', String(original)).and('contain', renamed);
            // Only the changed field was sent.
            cy.get('tbody tr').should('have.length', 1);
          });
          cy.get('body').type('{esc}');

          // Put it back for the other specs.
          cy.visit('/settings');
          cy.findField('Organization name').clear().type(String(original));
          cy.contains('button', 'Save changes').click();
          cy.contains('[role=status]', 'Settings saved');
        });
    });
  });

  it('filters the audit log by action', () => {
    cy.cloneUser('ethan.brooks@tempo.test').then((worker) =>
      asAdmin().then(() => {
        userRow(worker).find('button[aria-label="Sign out everywhere"]').click();
        cy.get('[role=dialog]').contains('button', 'Sign out').click();
        cy.visit('/audit-log');
        cy.findField('Action').click();
        cy.get('[role=combobox]').type('sessions revoked');
        cy.contains('[role=option]', 'User sessions revoked').click();
        cy.get('tbody tr')
          .should('have.length.at.least', 1)
          .each(($tr) => {
            expect($tr.text()).to.contain('User sessions revoked');
          });
      }),
    );
  });
});
