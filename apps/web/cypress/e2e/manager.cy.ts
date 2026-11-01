import { addDays, localDate, mondayOf } from '../support/dates.ts';

const lastMonday = () => addDays(mondayOf(localDate('Europe/Berlin')), -7);

describe('PM dashboard', () => {
  it('shows who is working right now, live, with ticking time', () => {
    cy.cloneUser('lena.fischer@tempo.test').then((worker) =>
      cy.apiLogin(worker).then((workerToken) =>
        cy.cloneUser('petra.neumann@tempo.test').then((pm) => {
          cy.login(pm);
          cy.visit('/dashboard');
          cy.contains('h2', 'Working now');
          cy.contains('li', worker.name).should('not.exist');

          cy.projectId(workerToken, 'Fleet Dashboard').then((projectId) =>
            cy.api('POST', '/timer/start', {
              token: workerToken,
              body: { projectId, description: 'Live map tiles' },
            }),
          );
          // Arrives through the socket, no reload.
          cy.contains('li', worker.name)
            .should('contain', 'Fleet Dashboard')
            .and('contain', 'Live map tiles');
          cy.contains('li', worker.name)
            .find('p.num')
            .first()
            .invoke('text')
            .then((first) => {
              cy.wait(2100);
              cy.contains('li', worker.name)
                .find('p.num')
                .first()
                .invoke('text')
                .should('not.eq', first);
            });

          cy.api('POST', '/timer/stop', { token: workerToken });
          cy.contains('li', worker.name).should('not.exist');
        }),
      ),
    );
  });

  it('lists budgets for managed projects only', () => {
    cy.cloneUser('petra.neumann@tempo.test').then((pm) => {
      cy.login(pm);
      cy.visit('/dashboard');
      cy.contains('h2', 'Hours vs budget');
      cy.contains('Fleet Dashboard');
      cy.contains('Care Mobile App');
      cy.contains('Route Optimizer API').should('not.exist');
      cy.get('[role=progressbar]').should('have.length.at.least', 2);
    });
  });
});

describe('managing a project', () => {
  it('adds, renames, completes and deletes a task', () => {
    cy.cloneUser('petra.neumann@tempo.test').then((pm) =>
      cy.apiLogin(pm).then((token) =>
        cy.projectId(token, 'Care Mobile App').then((projectId) => {
          cy.login(pm);
          cy.visit(`/projects/${projectId}`);
          const name = `Cy task ${Date.now() % 100000}`;
          cy.get('input[aria-label="New task name"]').type(`${name}{enter}`);
          cy.contains('li', name).should('be.visible');

          cy.contains('li', name)
            .find(`button[aria-label="Rename ${name}"]`)
            .click({ force: true });
          cy.get('input[aria-label="Task name"]').clear().type(`${name} v2{enter}`);
          cy.contains('li', `${name} v2`)
            .find('[role=checkbox]')
            .click()
            .should('have.attr', 'aria-checked', 'true');
          cy.api<{ name: string; isDone: boolean }[]>('GET', `/projects/${projectId}/tasks`, {
            token,
          })
            .its('body')
            .should((tasks) =>
              expect(tasks.find((t) => t.name === `${name} v2`)?.isDone).to.eq(true),
            );

          cy.contains('li', `${name} v2`)
            .find(`button[aria-label="Delete ${name} v2"]`)
            .click({ force: true });
          cy.contains('li', `${name} v2`).should('not.exist');
        }),
      ),
    );
  });

  it('edits the budget and a worker’s rate (both audited)', () => {
    cy.cloneUser('davit.grigoryan@tempo.test').then((worker) =>
      cy.cloneUser('petra.neumann@tempo.test').then((pm) =>
        cy.apiLogin(pm).then((token) =>
          cy.projectId(token, 'Care Mobile App').then((projectId) => {
            cy.login(pm);
            cy.visit(`/projects/${projectId}`);
            cy.contains('button', 'Edit budget').click();
            cy.get('[role=dialog]').within(() => {
              cy.findField('Budget (hours)').clear().type('750');
              cy.contains('button', 'Save').click();
            });
            cy.contains('h2', /^Budget$/)
              .parents('section')
              .first()
              .should('contain', '750 h');

            cy.contains('tr', worker.name).find('button[title="Change rate"]').click();
            cy.get('input[aria-label="Hourly rate"]').clear().type('92.5{enter}');
            cy.api<{ userId: string; hourlyRate: number }[]>(
              'GET',
              `/projects/${projectId}/members`,
              { token },
            )
              .its('body')
              .should((members) =>
                expect(members.find((m) => m.userId === worker.id)?.hourlyRate).to.eq(92.5),
              );
            cy.task<{ action: string }[]>('db:query', {
              text: 'SELECT action FROM audit_logs WHERE actor_id = $1 ORDER BY created_at',
              values: [pm.id],
            }).then((rows) => {
              const actions = rows.map((r) => r.action);
              expect(actions).to.include('project.updated');
              expect(actions).to.include('project.member_updated');
            });
            // Put the shared seed budget back.
            cy.api('PATCH', `/projects/${projectId}`, { token, body: { budgetHours: null } });
          }),
        ),
      ),
    );
  });

  it('a project the PM doesn’t manage is “not found”, even by link', () => {
    cy.cloneUser('marcus.reed@tempo.test').then((marcus) =>
      cy.apiLogin(marcus).then((marcusToken) =>
        cy.projectId(marcusToken, 'Route Optimizer API').then((foreignId) =>
          cy.cloneUser('petra.neumann@tempo.test').then((pm) => {
            cy.apiLogin(pm).then((token) => {
              for (const path of ['', '/members', '/usage', '/tasks'])
                cy.api('GET', `/projects/${foreignId}${path}`, { token })
                  .its('status')
                  .should('eq', 404);
            });
            cy.login(pm);
            cy.visit('/projects');
            cy.contains('Fleet Dashboard');
            cy.contains('Route Optimizer API').should('not.exist');
            cy.visit(`/projects/${foreignId}`);
            cy.contains('Project not found');
          }),
        ),
      ),
    );
  });
});

describe('PM reports', () => {
  it('filters by worker and period with exact totals, then exports CSV and PDF', () => {
    const monday = lastMonday();
    const sunday = addDays(monday, 6);
    cy.task('files:clear', 'cypress/downloads');
    cy.cloneUser('jonas.weber@tempo.test').then((worker) =>
      cy.apiLogin(worker).then((token) => {
        cy.projectId(token, 'Fleet Dashboard').then((fleet) => {
          cy.createEntry(token, { projectId: fleet, date: monday, start: '09:00', end: '12:30' });
          cy.createEntry(token, {
            projectId: fleet,
            date: addDays(monday, 2),
            start: '22:00',
            end: '01:30',
            endDate: addDays(monday, 3),
          });
        });
        // Not on Petra's projects: must not count in her report.
        cy.projectId(token, 'Patient Portal').then((portal) =>
          cy.createEntry(token, {
            projectId: portal,
            date: addDays(monday, 4),
            start: '10:00',
            end: '11:00',
          }),
        );
        cy.cloneUser('petra.neumann@tempo.test').then((pm) => {
          cy.login(pm);
          cy.visit('/reports');
          cy.contains('[role=radio]', 'Custom').click();
          cy.get('input[aria-label=From]').clear().type(monday);
          cy.get('input[aria-label=To]').clear().type(sunday);
          cy.findField('Worker').click();
          cy.contains('[role=option]', worker.name).click();

          cy.contains('.card', 'Total time').should('contain', '7:00');
          cy.contains('.card', 'Billable time').should('contain', '7:00');
          // Jonas's rate on Fleet Dashboard is 85/h in the seed: 7 h × 85.
          cy.contains('.card', 'Billable amount').should('contain', '595.00');
          cy.contains('.card', 'Entries').should('contain', '2');
          // Rows are per entry per local day: the midnight entry is two rows.
          cy.get('tbody tr').should('have.length', 3);

          cy.contains('button', 'CSV').click();
          cy.readFile(`cypress/downloads/tempo-report-${monday}_${sunday}.csv`).then(
            (csv: string) => {
              expect(csv).to.contain(worker.name);
              expect(csv).to.contain('Fleet Dashboard');
              expect(csv).not.to.contain('Patient Portal');
              expect(csv.trim().split('\n')).to.have.length(5); // header + 3 rows + total
            },
          );
          // Chrome holds back a second automatic download on the same page, so the PDF is
          // fetched with the same filters straight from the api.
          cy.apiLogin(pm).then((pmToken) =>
            cy
              .request({
                url: `/api/v1/reports/export.pdf?from=${monday}&to=${sunday}&userId=${worker.id}`,
                headers: { Authorization: `Bearer ${pmToken}` },
                encoding: 'binary',
              })
              .then((res) => {
                expect(res.status).to.eq(200);
                expect(res.headers['content-type']).to.contain('application/pdf');
                expect(String(res.body).startsWith('%PDF-')).to.eq(true);
              }),
          );
        });
      }),
    );
  });
});
