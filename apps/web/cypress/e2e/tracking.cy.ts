import type { ClonedUser } from '../tasks.ts';
import { addDays, localDate } from '../support/dates.ts';

const bar = () => cy.get('[role=region][aria-label=Timer]');
const timerButton = () => bar().find('button[aria-label$="timer (S)"]');
/** Presses S once the timer isn't busy (presses during a start/stop request are ignored). */
const pressS = () => {
  timerButton().should('not.be.disabled');
  cy.get('body').type('s');
};
const elapsed = () =>
  bar()
    .find('[aria-label^="Elapsed "]')
    .invoke('attr', 'aria-label')
    .then((label) => {
      const [h = 0, m = 0, s = 0] = String(label).replace('Elapsed ', '').split(':').map(Number);
      return h * 3600 + m * 60 + s;
    });

/** Entries of a user between two local dates, straight from the api. */
const entriesOf = (token: string, from: string, to: string) =>
  cy
    .api<
      {
        description: string;
        durationSeconds: number | null;
        startedAt: string;
        endedAt: string | null;
      }[]
    >('GET', '/time-entries', { token, qs: { from, to } })
    .its('body');

function openNewEntry() {
  cy.contains('button', 'Add entry').click();
  return cy.get('[role=dialog]').should('contain', 'New time entry');
}

function fillEntry(e: {
  project?: string;
  description?: string;
  date: string;
  start: string;
  end: string;
}) {
  cy.get('[role=dialog]').within(() => {
    if (e.project) {
      cy.findField('Project').click();
    }
  });
  if (e.project) cy.contains('[role=option]', e.project).click();
  cy.get('[role=dialog]').within(() => {
    if (e.description) cy.findField('Description').clear().type(e.description);
    cy.findField('Date').clear().type(e.date);
    cy.findField('Start').clear().type(e.start);
    cy.findField('End').clear().type(e.end);
  });
}
const submitEntry = () => cy.get('[role=dialog]').contains('button', 'Add entry').click();

describe('the timer', () => {
  let user: ClonedUser;
  let token: string;
  beforeEach(() => {
    cy.cloneUser('lena.fischer@tempo.test').then((u) => {
      user = u;
      // Api session first: apiLogin drops cookies so the browser doesn't share its session.
      cy.apiLogin(user).then((t) => (token = t));
      cy.login(user);
    });
  });

  it('starts and stops on the server clock, with the time in the tab title', () => {
    bar().find('input[aria-label=Description]').type('Clustering spike');
    bar().find('button[aria-haspopup=listbox]').click();
    cy.contains('[role=option]', 'Fleet Dashboard').click();
    timerButton().click().should('have.attr', 'aria-pressed', 'true');
    elapsed().should('be.gte', 0);
    cy.wait(2100);
    elapsed().should('be.gte', 2);
    cy.title().should('match', /^\d{2}:\d{2}:\d{2} · /);

    timerButton().click().should('have.attr', 'aria-pressed', 'false');
    cy.title().should('not.match', /^\d{2}:\d{2}:\d{2}/);
    cy.get('main input[aria-label=Description]').should(($inputs) => {
      expect([...$inputs].map((i) => (i as HTMLInputElement).value)).to.include('Clustering spike');
    });
  });

  it('S starts and stops it, N opens a new entry — but not while typing', () => {
    // Without a project yet, S asks for one first.
    pressS();
    cy.get('[role=listbox]').should('be.visible');
    cy.contains('[role=option]', 'Fleet Dashboard').click();
    pressS();
    timerButton().should('have.attr', 'aria-pressed', 'true');
    pressS();
    timerButton().should('have.attr', 'aria-pressed', 'false');

    bar().find('input[aria-label=Description]').type('notes with s and n');
    timerButton().should('have.attr', 'aria-pressed', 'false');
    cy.get('[role=dialog]').should('not.exist');

    bar().find('input[aria-label=Description]').blur();
    cy.get('body').type('n');
    cy.get('[role=dialog]').should('contain', 'New time entry');
  });

  it('keeps running across reloads, counting from the server’s start time', () => {
    bar().find('button[aria-haspopup=listbox]').click();
    cy.contains('[role=option]', 'Care Mobile App').click();
    pressS();
    timerButton().should('have.attr', 'aria-pressed', 'true');
    cy.wait(1500);
    elapsed().then((before) => {
      cy.reload();
      timerButton().should('have.attr', 'aria-pressed', 'true');
      elapsed().should('be.gte', before);
    });
    pressS();
    timerButton().should('have.attr', 'aria-pressed', 'false');
  });

  it('follows a timer started on another device, live', () => {
    cy.wrap(null).then(() => {
      timerButton().should('have.attr', 'aria-pressed', 'false');
      cy.projectId(token, 'Care Mobile App').then((projectId) => {
        cy.api('POST', '/timer/start', { token, body: { projectId, description: 'From my phone' } })
          .its('status')
          .should('be.oneOf', [200, 201]);
      });
      timerButton().should('have.attr', 'aria-pressed', 'true');
      bar().find('input[aria-label=Description]').should('have.value', 'From my phone');
      cy.api('POST', '/timer/stop', { token });
      timerButton().should('have.attr', 'aria-pressed', 'false');
    });
  });

  it('“Continue” restarts a past entry’s work', () => {
    cy.wrap(null).then(() => {
      cy.projectId(token, 'Fleet Dashboard').then((projectId) =>
        cy.createEntry(token, {
          projectId,
          date: localDate(user.timezone, -1),
          start: '06:00',
          end: '06:30',
          description: 'Morning triage',
        }),
      );
      cy.reload();
      cy.get('main input[aria-label=Description]')
        .filter((_, el) => (el as HTMLInputElement).value === 'Morning triage')
        .first()
        .parents('[class*="group"]')
        .first()
        .within(() => cy.get('button[aria-label=Continue]').click({ force: true }));
      timerButton().should('have.attr', 'aria-pressed', 'true');
      bar().find('input[aria-label=Description]').should('have.value', 'Morning triage');
      cy.api('POST', '/timer/stop', { token });
    });
  });
});

describe('manual entries', () => {
  it('adds an entry and lists it with its duration', () => {
    cy.cloneUser('lena.fischer@tempo.test').then((user) => {
      cy.login(user);
      const day = localDate(user.timezone, -1);
      openNewEntry();
      fillEntry({
        project: 'Fleet Dashboard',
        description: 'Spec review',
        date: day,
        start: '05:00',
        end: '06:45',
      });
      cy.get('[role=dialog]').contains('01:45:00');
      submitEntry();
      cy.get('[role=dialog]').should('not.exist');
      cy.contains('[role=status]', /added|saved/i);
      cy.apiLogin(user).then((token) =>
        entriesOf(token, day, day).then((list) => {
          const entry = list.find((e) => e.description === 'Spec review');
          expect(entry?.durationSeconds).to.eq(6300);
        }),
      );
    });
  });

  it('refuses an overlapping entry and explains why', () => {
    cy.cloneUser('lena.fischer@tempo.test').then((user) => {
      cy.apiLogin(user).then((token) =>
        cy.projectId(token, 'Fleet Dashboard').then((projectId) =>
          cy.createEntry(token, {
            projectId,
            date: localDate(user.timezone, -2),
            start: '05:00',
            end: '06:00',
          }),
        ),
      );
      cy.login(user);
      openNewEntry();
      fillEntry({ date: localDate(user.timezone, -2), start: '05:30', end: '06:30' });
      submitEntry();
      cy.get('[role=dialog] [role=alert]').should('contain', 'Entries can’t overlap');
      cy.get('[role=dialog]').within(() => cy.findField('Start').clear().type('06:00'));
      submitEntry();
      cy.get('[role=dialog]').should('not.exist');
    });
  });

  it('an end before the start means the next day, and the time is split at midnight', () => {
    cy.cloneUser('lena.fischer@tempo.test').then((user) => {
      cy.login(user);
      const day = localDate(user.timezone, -3);
      openNewEntry();
      fillEntry({ description: 'Release night', date: day, start: '22:00', end: '01:30' });
      cy.get('[role=dialog]').should('contain', '+1 day').and('contain', '03:30:00');
      submitEntry();
      cy.get('[role=dialog]').should('not.exist');
      cy.apiLogin(user).then((token) =>
        cy
          .api<{ byDay: { date: string; seconds: number }[] }>('GET', '/reports', {
            token,
            qs: { from: day, to: addDays(day, 1) },
          })
          .then((res) => {
            const byDay = Object.fromEntries(res.body.byDay.map((d) => [d.date, d.seconds]));
            expect(byDay[day]).to.be.gte(7200);
            expect(byDay[addDays(day, 1)]).to.be.gte(5400);
          }),
      );
    });
  });

  it('refuses entries in a locked period', () => {
    cy.cloneUser('lena.fischer@tempo.test').then((user) => {
      cy.login(user);
      openNewEntry();
      fillEntry({ date: localDate(user.timezone, -45), start: '09:00', end: '10:00' });
      submitEntry();
      cy.get('[role=dialog] [role=alert]').should('contain', 'locked');
    });
  });
});

describe('daylight saving time (fixed 2026 dates)', () => {
  // These dates age past the 30-day lock period, so lift it meanwhile and restore it exactly.
  let lock: unknown = null;
  before(() => {
    cy.task<{ lock_after_days: number | null }[]>('db:query', {
      text: 'SELECT lock_after_days FROM org_settings WHERE id = 1',
    }).then((rows) => {
      lock = rows[0]?.lock_after_days ?? null;
      cy.task('db:query', { text: 'UPDATE org_settings SET lock_after_days = NULL WHERE id = 1' });
    });
  });
  after(() => {
    cy.task('db:query', {
      text: 'UPDATE org_settings SET lock_after_days = $1 WHERE id = 1',
      values: [lock],
    });
  });

  it('asks which 02:30 is meant on the night clocks go back (Berlin, 25 Oct 2026)', () => {
    cy.cloneUser('lena.fischer@tempo.test').then((user) => {
      cy.login(user);
      openNewEntry();
      fillEntry({
        description: 'DST night shift',
        date: '2026-10-25',
        start: '02:30',
        end: '03:30',
      });
      submitEntry();
      cy.get('[role=group][aria-label="Which start time?"]').should('contain', 'happens twice');
      cy.contains('button', 'The first time (before clocks go back)').should('contain', '+02:00');
      cy.contains('button', 'The second time (after clocks go back)').should('contain', '+01:00');
      cy.contains('button', 'The first time (before clocks go back)').click();
      cy.get('[role=dialog]').should('not.exist');
      cy.apiLogin(user).then((token) =>
        entriesOf(token, '2026-10-25', '2026-10-25').then((list) => {
          const entry = list.find((e) => e.description === 'DST night shift');
          // 02:30 CEST → 03:30 CET is two real hours.
          expect(entry?.durationSeconds).to.eq(7200);
          expect(entry?.startedAt).to.eq('2026-10-25T00:30:00.000Z');
        }),
      );
    });
  });

  it('refuses a time skipped when clocks jump forward (Sydney, 4 Oct 2026)', () => {
    cy.cloneUser('lena.fischer@tempo.test', { timezone: 'Australia/Sydney' }).then((user) => {
      cy.login(user);
      openNewEntry();
      fillEntry({ date: '2026-10-04', start: '02:30', end: '04:00' });
      submitEntry();
      cy.get('[role=dialog]').should('contain', 'does not exist').and('contain', 'jump forward');
    });
  });
});

describe('editing entries in the list', () => {
  let user: ClonedUser;
  let token: string;
  const day = () => localDate(user.timezone, -1);
  beforeEach(() => {
    cy.cloneUser('lena.fischer@tempo.test').then((u) => {
      user = u;
      cy.apiLogin(user).then((t) => {
        token = t;
        cy.projectId(token, 'Fleet Dashboard').then((projectId) =>
          cy.createEntry(token, {
            projectId,
            date: day(),
            start: '05:00',
            end: '05:40',
            description: 'Original',
          }),
        );
      });
      cy.login(user);
    });
  });
  const row = () =>
    cy
      .get('main input[aria-label=Description]')
      .filter((_, el) => (el as HTMLInputElement).value === 'Original')
      .first();

  it('edits the description inline and keeps it after a reload', () => {
    row().clear().type('Renamed inline{enter}');
    cy.reload();
    cy.get('main input[aria-label=Description]').should(($inputs) => {
      expect([...$inputs].map((i) => (i as HTMLInputElement).value)).to.include('Renamed inline');
    });
    entriesOf(token, day(), day()).then((list) =>
      expect(list.map((e) => e.description)).to.include('Renamed inline'),
    );
  });

  it('duplicates an entry to today', () => {
    row()
      .parents('[class*="group"]')
      .first()
      .within(() => cy.get('button[aria-label="Duplicate to today"]').click({ force: true }));
    const today = localDate(user.timezone);
    cy.wrap(null).should(() => undefined);
    entriesOf(token, today, today).should((list) => {
      expect(list.filter((e) => e.description === 'Original')).to.have.length(1);
    });
  });

  it('deletes after a confirmation', () => {
    row()
      .parents('[class*="group"]')
      .first()
      .within(() => cy.get('button[aria-label=Delete]').click({ force: true }));
    cy.get('[role=dialog]')
      .should('contain', 'Delete this entry?')
      .contains('button', 'Delete')
      .click();
    cy.get('[role=dialog]').should('not.exist');
    entriesOf(token, day(), day()).should((list) => {
      expect(list.map((e) => e.description)).not.to.include('Original');
    });
  });
});
