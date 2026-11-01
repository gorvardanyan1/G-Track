import type { ClonedUser } from '../tasks.ts';
import { addDays, localDate, mondayOf } from '../support/dates.ts';

/** The Monday of last week in Berlin (the seeded organization's weeks start on Monday). */
const lastMonday = () => addDays(mondayOf(localDate('Europe/Berlin')), -7);

interface Week {
  worker: ClonedUser;
  pm: ClonedUser;
  workerToken: string;
  pmToken: string;
  entryIds: string[];
}

/**
 * A worker on Petra's "Fleet Dashboard" (and Marcus's "Patient Portal") with known time last
 * week, and a fresh PM of Fleet Dashboard:
 *   Mon 09:00–12:30 Fleet (3:30) · Wed 22:00 → Thu 01:30 Fleet (2:00 + 1:30) · Sat 10–11 Patient Portal (1:00)
 */
function weekWithTime(): Cypress.Chainable<Week> {
  const week = {} as Week;
  const monday = lastMonday();
  return cy
    .cloneUser('jonas.weber@tempo.test')
    .then((worker) => (week.worker = worker))
    .then(() => cy.cloneUser('petra.neumann@tempo.test'))
    .then((pm) => (week.pm = pm))
    .then(() => cy.apiLogin(week.pm))
    .then((t) => (week.pmToken = t))
    .then(() => cy.apiLogin(week.worker))
    .then((token) => {
      week.workerToken = token;
      week.entryIds = [];
      cy.projectId(token, 'Fleet Dashboard').then((fleet) => {
        cy.createEntry(token, {
          projectId: fleet,
          date: monday,
          start: '09:00',
          end: '12:30',
        }).then((e) => week.entryIds.push(String(e['id'])));
        cy.createEntry(token, {
          projectId: fleet,
          date: addDays(monday, 2),
          start: '22:00',
          end: '01:30',
          endDate: addDays(monday, 3),
          description: 'Release night',
        }).then((e) => week.entryIds.push(String(e['id'])));
      });
      cy.projectId(token, 'Patient Portal').then((portal) =>
        cy.createEntry(token, {
          projectId: portal,
          date: addDays(monday, 5),
          start: '10:00',
          end: '11:00',
        }),
      );
    })
    .then(() => week);
}

const gridRow = (name: string) => cy.contains('tbody tr', name);
const sheetOf = (token: string) =>
  cy.api<{ id: string | null; status: string; totalSeconds: number }>('GET', '/timesheets/me', {
    token,
    qs: { week: lastMonday() },
  });

describe('weekly timesheets', () => {
  it('shows exact totals per project and day, then locks the week on submit', () => {
    weekWithTime().then((w) => {
      cy.login(w.worker);
      cy.visit('/week');
      cy.get('button[aria-label="Previous week"]').click();
      gridRow('Fleet Dashboard')
        .should('contain', '3:30')
        .and('contain', '2:00')
        .and('contain', '1:30');
      gridRow('Fleet Dashboard').find('td').last().should('contain', '7:00');
      gridRow('Patient Portal').find('td').last().should('contain', '1:00');
      cy.contains('tfoot tr', 'Total').find('td').last().should('contain', '8:00');
      cy.contains('Draft');

      cy.contains('button', 'Submit week').click();
      cy.get('[role=dialog]').should('contain', '8:00').contains('button', 'Submit').click();
      cy.contains('Submitted');
      cy.contains('button', 'Submit week').should('not.exist');

      // Submitted weeks are read-only for their owner.
      cy.api<{ error: { code: string } }>('PATCH', `/time-entries/${w.entryIds[0]}`, {
        token: w.workerToken,
        body: { description: 'sneaky edit' },
      }).then((res) => {
        expect(res.status).to.eq(409);
        expect(res.body.error.code).to.eq('PERIOD_LOCKED');
      });
      sheetOf(w.workerToken)
        .its('body')
        .should('include', { status: 'SUBMITTED', totalSeconds: 8 * 3600 });
    });
  });

  it('each PM approves their own project’s part; the week is approved when both have', () => {
    weekWithTime().then((w) => {
      cy.api('POST', '/timesheets/submit', { token: w.workerToken, body: { week: lastMonday() } })
        .its('status')
        .should('eq', 200);
      // Petra manages Fleet Dashboard; Patient Portal is Marcus's.
      cy.login(w.pm);
      cy.visit('/approvals');
      cy.contains('tr', w.worker.name).contains('button', 'Review').click();
      cy.get('[role=dialog]').within(() => {
        cy.contains('tr', 'Fleet Dashboard').should('contain', '7:00');
        cy.contains('tr', 'Other projects').should('contain', '1:00');
        cy.contains('Patient Portal').should('not.exist');
        cy.contains('tfoot', '8:00');
        cy.get('[aria-label="Approval by project"] li').should('have.length', 2);
        cy.contains('li', 'Fleet Dashboard').should('contain', 'yours to review');
        cy.contains('li', 'Another project').should('contain', 'Waiting');
        cy.get('#review-comment').type('Fleet part looks good.');
        cy.contains('button', 'Approve').click();
      });
      cy.get('[role=dialog]').should('not.exist');
      cy.contains('[role=status]', 'Your part is approved');
      cy.contains('tr', w.worker.name).should('not.exist');
      // The week still waits for Marcus, so it stays locked.
      sheetOf(w.workerToken).its('body.status').should('eq', 'SUBMITTED');
      sheetOf(w.workerToken)
        .its('body.id')
        .then((id) =>
          cy
            .api('POST', `/timesheets/${String(id)}/approve`, { token: w.pmToken, body: {} })
            .its('status')
            .should('eq', 403),
        );

      cy.cloneUser('marcus.reed@tempo.test').then((marcus) => {
        cy.clearAllCookies();
        cy.login(marcus);
        cy.visit('/approvals');
        cy.contains('tr', w.worker.name).contains('button', 'Review').click();
        cy.get('[role=dialog]').within(() => {
          cy.contains('li', 'Patient Portal').should('contain', 'yours to review');
          cy.contains('button', 'Approve').click();
        });
        cy.contains('[role=status]', 'Timesheet approved');
      });
      sheetOf(w.workerToken).its('body.status').should('eq', 'APPROVED');
      sheetOf(w.workerToken)
        .its('body.reviews')
        .should((reviews: { status: string }[]) =>
          expect(reviews.map((r) => r.status)).to.deep.eq(['APPROVED', 'APPROVED']),
        );
      cy.task<{ action: string }[]>('db:query', {
        text: `SELECT action FROM audit_logs WHERE actor_id = $1 ORDER BY created_at DESC LIMIT 1`,
        values: [w.pm.id],
      })
        .its('0.action')
        .should('eq', 'timesheet.approved');
    });
  });

  it('returning a week needs a comment; the worker sees it, edits and resubmits', () => {
    weekWithTime().then((w) => {
      cy.api('POST', '/timesheets/submit', { token: w.workerToken, body: { week: lastMonday() } });
      cy.login(w.pm);
      cy.visit('/approvals');
      cy.contains('tr', w.worker.name).contains('button', 'Review').click();
      cy.get('[role=dialog]').contains('button', 'Return for changes').click();
      cy.get('[role=dialog]').should('contain', 'Say what needs to change');
      cy.get('#review-comment').type('Wednesday night looks long — please check.');
      cy.get('[role=dialog]').contains('button', 'Return for changes').click();
      cy.get('[role=dialog]').should('not.exist');
      sheetOf(w.workerToken).its('body.status').should('eq', 'REJECTED');

      cy.clearAllCookies();
      cy.login(w.worker);
      cy.visit('/week');
      cy.get('button[aria-label="Previous week"]').click();
      cy.contains(`${w.pm.name} returned this week`);
      cy.contains('Wednesday night looks long — please check.');
      cy.contains('Needs changes');
      // Editable again.
      cy.api('PATCH', `/time-entries/${w.entryIds[1]}`, {
        token: w.workerToken,
        body: { description: 'Release night (checked)' },
      })
        .its('status')
        .should('eq', 200);
      cy.contains('button', 'Submit week').click();
      cy.get('[role=dialog]').contains('button', 'Submit').click();
      cy.contains('Submitted');
    });
  });

  it('nobody reviews their own week, and PMs can’t see strangers’ timesheets', () => {
    cy.cloneUser('petra.neumann@tempo.test').then((pm) =>
      cy.apiLogin(pm).then((pmToken) => {
        cy.api<{ id: string }>('POST', '/timesheets/submit', {
          token: pmToken,
          body: { week: lastMonday() },
        }).then((res) => {
          expect(res.status).to.eq(200);
          cy.api('POST', `/timesheets/${res.body.id}/approve`, { token: pmToken, body: {} })
            .its('status')
            .should('eq', 403);
        });
        // Sofia works only on Marcus's projects.
        cy.cloneUser('sofia.martinez@tempo.test').then((stranger) =>
          cy.apiLogin(stranger).then((token) =>
            cy
              .api<{ id: string }>('POST', '/timesheets/submit', {
                token,
                body: { week: lastMonday() },
              })
              .then((res) =>
                cy
                  .api('GET', `/timesheets/${res.body.id}`, { token: pmToken })
                  .its('status')
                  .should('eq', 404),
              ),
          ),
        );
        cy.login(pm);
        cy.visit('/approvals');
        cy.contains('tr', pm.name).should('not.exist');
      }),
    );
  });
});
