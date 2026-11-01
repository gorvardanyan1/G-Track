import { PASSWORD } from '../support/constants.ts';
import type { ClonedUser } from '../tasks.ts';

const signOut = () => {
  cy.get('button[aria-label^="Account menu"]').click();
  cy.contains('button', 'Sign out').click();
  cy.location('pathname').should('eq', '/login');
};

describe('signing in', () => {
  it('sends each role to its home page (PMs track time too) and shows their name', () => {
    const homes: [string, Record<string, unknown>, string][] = [
      ['lena.fischer@tempo.test', {}, '/today'],
      ['petra.neumann@tempo.test', {}, '/today'],
      ['admin@tempo.test', { totp: true }, '/dashboard'],
    ];
    for (const [from, options, home] of homes) {
      cy.clearAllCookies();
      cy.cloneUser(from, options).then((user) => {
        cy.login(user);
        cy.location('pathname').should('eq', home);
        cy.get(`button[aria-label="Account menu for ${user.name}"]`).should('be.visible');
      });
    }
  });

  it('refuses a wrong password with a clear message and clears the field', () => {
    cy.cloneUser('jonas.weber@tempo.test').then((user) => {
      cy.visit('/login');
      cy.findField('Email').type(user.email);
      cy.get('#password').type('not the password');
      cy.contains('button', 'Sign in').click();
      cy.get('[role=alert]').should('contain', 'That email and password don’t match.');
      cy.get('#password').should('have.value', '');
      cy.location('pathname').should('eq', '/login');
    });
  });

  it('returns to the page asked for after signing in, and never to another site', () => {
    cy.cloneUser('lena.fischer@tempo.test').then((user) => {
      cy.visit('/week');
      cy.location('pathname').should('eq', '/login');
      cy.location('search').should((search) =>
        expect(new URLSearchParams(search).get('redirect')).to.eq('/week'),
      );
      cy.findField('Email').type(user.email);
      cy.get('#password').type(PASSWORD);
      cy.contains('button', 'Sign in').click();
      cy.location('pathname').should('eq', '/week');

      cy.clearAllCookies();
      cy.visit('/login?redirect=%2F%2Fevil.example.com');
      cy.findField('Email').type(user.email);
      cy.get('#password').type(PASSWORD);
      cy.contains('button', 'Sign in').click();
      cy.location('host').should('eq', new URL(Cypress.config('baseUrl')!).host);
      cy.location('pathname').should('eq', '/today');
    });
  });

  it('asks Super Admins for their 2FA code, and rejects a wrong one', () => {
    cy.cloneUser('admin@tempo.test', { totp: true }).then((admin) => {
      cy.visit('/login');
      cy.findField('Email').type(admin.email);
      cy.get('#password').type(PASSWORD);
      cy.contains('button', 'Sign in').click();
      cy.location('pathname').should('eq', '/login/2fa');
      cy.get('input[autocomplete="one-time-code"]').invoke('val', '000000').trigger('input');
      cy.get('[role=alert]').should('be.visible');
      cy.location('pathname').should('eq', '/login/2fa');
      cy.task<string>('totp', { secret: admin.totpSecret }).then((code) => {
        cy.get('input[autocomplete="one-time-code"]').invoke('val', code).trigger('input');
      });
      cy.location('pathname').should('eq', '/dashboard');
    });
  });

  it('signs out, and the session is gone (back button and reload stay signed out)', () => {
    cy.cloneUser('jonas.weber@tempo.test').then((user) => {
      cy.login(user);
      signOut();
      cy.go('back');
      cy.location('pathname').should('eq', '/login');
      cy.visit('/today');
      cy.location('pathname').should('eq', '/login');
    });
  });
});

describe('password reset', () => {
  it('mails a link that sets a new password and signs out other sessions', () => {
    cy.cloneUser('sofia.martinez@tempo.test').then((user: ClonedUser) => {
      cy.apiLogin(user).then((oldToken) => {
        cy.visit('/forgot-password');
        cy.findField('Email').type(user.email);
        cy.contains('button', 'Send reset link').click();
        cy.contains(/check your/i);

        cy.latestMail(user.email).then((mail) => {
          const link = /https?:\/\/\S+/.exec(mail.text)?.[0] ?? '';
          expect(link).to.contain('/reset-password#token=');
          cy.visit(link.replace(/^https?:\/\/[^/]+/, ''));
        });
        const fresh = 'amber lantern over quiet harbor';
        cy.findField('New password').type(fresh);
        cy.findField('Repeat password').type(fresh);
        cy.contains('button', 'Set new password').click();
        cy.contains('You’ve been signed out everywhere.');

        // The session from before the reset is dead.
        cy.api('GET', '/auth/me', { token: oldToken }).its('status').should('eq', 401);
        // The old password no longer works; the new one does.
        cy.visit('/login');
        cy.findField('Email').type(user.email);
        cy.get('#password').type(PASSWORD);
        cy.contains('button', 'Sign in').click();
        cy.get('[role=alert]').should('contain', 'don’t match');
        cy.login(user, fresh);
        cy.location('pathname').should('eq', '/today');
      });
    });
  });

  it('answers the same for unknown emails (no account enumeration)', () => {
    cy.visit('/forgot-password');
    cy.findField('Email').type('nobody.here@tempo.test');
    cy.contains('button', 'Send reset link').click();
    cy.contains(/check your/i);
    cy.task('mail:latest', 'nobody.here@tempo.test').should('be.null');
  });
});

describe('role-based pages', () => {
  it('shows a worker the same “not found” for admin and manager pages', () => {
    cy.cloneUser('lena.fischer@tempo.test').then((user) => {
      cy.login(user);
      for (const path of ['/users', '/settings', '/audit-log', '/dashboard', '/approvals']) {
        cy.visit(path);
        cy.contains('Page not found');
      }
      cy.get('nav').should('not.contain', 'Users').and('not.contain', 'Approvals');
    });
  });

  it('gives PMs the Manage menu but not the Admin one', () => {
    cy.cloneUser('petra.neumann@tempo.test').then((user) => {
      cy.login(user);
      cy.get('nav').should('contain', 'Dashboard').and('contain', 'Approvals');
      cy.get('nav').should('not.contain', 'Audit log');
      cy.visit('/settings');
      cy.contains('Page not found');
    });
  });

  it('unknown pages show the 404 page', () => {
    cy.cloneUser('lena.fischer@tempo.test').then((user) => {
      cy.login(user);
      cy.visit('/definitely/not/here');
      cy.contains('Page not found');
    });
  });
});
