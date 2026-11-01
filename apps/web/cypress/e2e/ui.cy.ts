import type { ClonedUser } from '../tasks.ts';

const deviceZone = () =>
  cy.window().then((win) => win.Intl.DateTimeFormat().resolvedOptions().timeZone);

describe('app shell', () => {
  let user: ClonedUser;
  beforeEach(() => {
    cy.cloneUser('jonas.weber@tempo.test').then((u) => {
      user = u;
      cy.login(user);
    });
  });

  it('removes the launch screen once the app is ready', () => {
    cy.visit('/today');
    cy.get('#boot').should('not.exist');
    cy.contains('h1', 'Today');
  });

  it('remembers the theme across reloads', () => {
    cy.get('[role=radiogroup][aria-label=Theme] [aria-label=Dark]').click();
    cy.get('html').should('have.class', 'dark');
    cy.reload();
    cy.get('html').should('have.class', 'dark');
    cy.get('[role=radiogroup][aria-label=Theme] [aria-label=Dark]').should(
      'have.attr',
      'aria-checked',
      'true',
    );
    cy.get('[role=radiogroup][aria-label=Theme] [aria-label=Light]').click();
    cy.get('html').should('not.have.class', 'dark');
  });

  it('remembers a collapsed sidebar', () => {
    cy.get('button[aria-label="Collapse sidebar"]').click();
    cy.reload();
    cy.get('button[aria-label="Expand sidebar"]').should('exist').click();
    cy.get('button[aria-label="Collapse sidebar"]').should('exist');
  });

  it('works on a phone: the menu is an inert drawer until opened, and closes after navigating', () => {
    const drawer = () => cy.get('aside[aria-label="Main navigation"]');
    cy.viewport('iphone-x');
    cy.visit('/today');
    // Closed: off-screen and unreachable by keyboard or screen reader.
    drawer().should('have.attr', 'inert');
    cy.get('button[aria-label="Open navigation"]').click();
    drawer().should('not.have.attr', 'inert');
    drawer().contains('a', 'Timesheet').should('be.visible').click();
    cy.location('pathname').should('eq', '/week');
    drawer().should('have.attr', 'inert');
    cy.document().then((doc) => expect(doc.documentElement.scrollWidth).to.be.at.most(375));
  });

  it('on desktop the sidebar is always reachable', () => {
    cy.get('aside[aria-label="Main navigation"]').should('not.have.attr', 'inert');
  });

  it('updates the name everywhere after saving the profile', () => {
    cy.visit('/profile');
    cy.findField('Name').clear().type('Jonas Renamed');
    cy.contains('button', 'Save changes').click();
    cy.get('button[aria-label="Account menu for Jonas Renamed"]').should('exist');
    cy.reload();
    cy.get('button[aria-label="Account menu for Jonas Renamed"]').should('exist');
  });
});

describe('timezone mismatch banner', () => {
  it('appears when the device and profile zones differ; “Keep” is remembered', () => {
    deviceZone().then((device) => {
      // Pick a profile zone that surely differs from this device's.
      const profileZone = device === 'Asia/Tokyo' ? 'Europe/Berlin' : 'Asia/Tokyo';
      cy.cloneUser('lena.fischer@tempo.test', { timezone: profileZone }).then((user) => {
        cy.login(user);
        cy.contains(`This device is in ${device}`).should('be.visible');
        cy.contains('button', `Keep ${profileZone}`).click();
        cy.contains(`This device is in`).should('not.exist');
        cy.reload();
        cy.contains('h1', 'Today');
        cy.contains(`This device is in`).should('not.exist');
      });
    });
  });

  it('“Use <device zone>” switches the profile', () => {
    deviceZone().then((device) => {
      const profileZone = device === 'Asia/Tokyo' ? 'Europe/Berlin' : 'Asia/Tokyo';
      cy.cloneUser('lena.fischer@tempo.test', { timezone: profileZone }).then((user) => {
        cy.login(user);
        cy.contains('button', `Use ${device}`).click();
        cy.contains(`This device is in`).should('not.exist');
        cy.task<{ timezone: string }[]>('db:query', {
          text: 'SELECT timezone FROM users WHERE id = $1',
          values: [user.id],
        })
          .its('0.timezone')
          .should('eq', device);
      });
    });
  });

  it('stays hidden when the zones match', () => {
    deviceZone().then((device) => {
      cy.cloneUser('lena.fischer@tempo.test', { timezone: device }).then((user) => {
        cy.login(user);
        cy.contains('h1', 'Today');
        cy.contains('This device is in').should('not.exist');
      });
    });
  });
});

describe('server clock', () => {
  it('warns about a wrong device clock and still times by the server', () => {
    const aheadMs = 10 * 60_000;
    // The "server" says it's 10 minutes later than this device thinks.
    cy.intercept({ url: '/api/**' }, (req) => {
      req.on('response', (res) => {
        res.headers['x-server-time'] = String(Date.now() + aheadMs);
      });
    });
    cy.cloneUser('jonas.weber@tempo.test').then((user) => {
      cy.login(user);
      cy.contains('Clock off by 10 min');
      cy.get('[role=region][aria-label=Timer] button[aria-haspopup=listbox]').click();
      cy.contains('[role=option]', 'Fleet Dashboard').click();
      // The api records the real start time, but this page believes the server is 10 minutes
      // ahead, so it shows ~10 minutes at once: proof that the display runs on the measured
      // server offset, not on the device clock.
      cy.get('[role=region][aria-label=Timer] button[aria-label="Start timer (S)"]').click();
      cy.get('[role=region][aria-label=Timer] [aria-label^="Elapsed "]')
        .invoke('attr', 'aria-label')
        .should('match', /^Elapsed 00:(09|10):\d{2}$/);
      cy.get('[role=region][aria-label=Timer] button[aria-label="Stop timer (S)"]').click();
    });
  });
});
