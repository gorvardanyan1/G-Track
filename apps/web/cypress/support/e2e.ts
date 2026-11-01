/// <reference types="cypress" />
import type { ClonedUser } from '../tasks.ts';

import { PASSWORD } from './constants.ts';
/** The api through the web app's own proxy, exactly like the browser reaches it. */
const apiUrl = () => `${Cypress.config('baseUrl') ?? ''}/api/v1`;

/**
 * Every test poses as its own client IP. The e2e api trusts exactly one proxy hop (like
 * production behind nginx), so per-IP rate limits (e.g. 30 logins / 15 min) apply per test,
 * not to the whole run.
 */
let clientIp = '10.0.0.1';
function ipFor(name: string): string {
  const hash = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return `10.${(hash >> 16) & 255}.${(hash >> 8) & 255}.${(hash & 254) + 1}`;
}
const apiHeaders = (token?: string) => ({
  Origin: Cypress.config('baseUrl') ?? '',
  'X-Forwarded-For': clientIp,
  ...(token && { Authorization: `Bearer ${token}` }),
});

beforeEach(() => {
  clientIp = ipFor(
    `${Cypress.spec.name}|${Cypress.currentTest.titlePath.join('|')}|${Cypress.currentRetry}`,
  );
  const ip = clientIp;
  cy.intercept({ url: '/api/**' }, (req) => {
    req.headers['x-forwarded-for'] = ip;
  });
});

export interface ApiOptions {
  token?: string;
  body?: Cypress.RequestBody;
  qs?: Record<string, string>;
}

export interface EntryInput {
  projectId: string;
  date: string;
  start: string;
  end: string;
  /** Defaults to the start date (an end time before the start needs the next day here). */
  endDate?: string;
  description?: string;
  isBillable?: boolean;
  taskId?: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      /** Api request with the spec's client IP and Origin; never fails on status. */
      api<T = unknown>(method: string, path: string, options?: ApiOptions): Chainable<Response<T>>;
      /** Access token via the api (2FA answered when the user has a secret). No cookie kept. */
      apiLogin(user: Pick<ClonedUser, 'email' | 'totpSecret'>): Chainable<string>;
      /** Signs in through the login page (and the 2FA step when needed). */
      login(user: Pick<ClonedUser, 'email' | 'totpSecret'>, password?: string): Chainable<void>;
      cloneUser(from: string, options?: Record<string, unknown>): Chainable<ClonedUser>;
      projectId(token: string, name: string): Chainable<string>;
      createEntry(token: string, entry: EntryInput): Chainable<Record<string, unknown>>;
      /** The newest mail to `to`, waiting for the api's background send. */
      latestMail(to: string): Chainable<{ subject: string; text: string }>;
      /** A form field by its visible label. */
      findField(label: string): Chainable<JQuery<HTMLElement>>;
    }
  }
}

// The declared command is generic in the response body; Cypress can't express that for the
// implementation, hence the one cast.
Cypress.Commands.add('api', ((method: string, path: string, options: ApiOptions = {}) =>
  cy.request({
    method,
    url: `${apiUrl()}${path}`,
    headers: apiHeaders(options.token),
    body: options.body,
    qs: options.qs,
    failOnStatusCode: false,
  })) as Cypress.CommandFn<'api'>);

Cypress.Commands.add('apiLogin', (user) => {
  return cy
    .api<{ status: string; accessToken?: string; challengeToken?: string }>('POST', '/auth/login', {
      body: { email: user.email, password: PASSWORD },
    })
    .then((res) => {
      expect(res.status, 'api login').to.eq(200);
      if (res.body.status === 'authenticated') return cy.wrap(res.body.accessToken as string);
      expect(res.body.status).to.eq('two_factor_required');
      return cy.task<string>('totp', { secret: user.totpSecret }).then((code) =>
        cy
          .api<{ accessToken: string }>('POST', '/auth/login/2fa', {
            body: { challengeToken: res.body.challengeToken, code },
          })
          .then((second) => {
            expect(second.status, 'api 2fa').to.eq(200);
            return second.body.accessToken;
          }),
      );
    })
    .then((token) => {
      // The api set a refresh cookie for this session; the browser must not pick it up.
      cy.clearAllCookies();
      return cy.wrap(token);
    });
});

Cypress.Commands.add('login', (user, password = PASSWORD) => {
  cy.visit('/login');
  cy.findField('Email').clear().type(user.email);
  cy.get('#password').clear().type(password, { log: false });
  cy.contains('button', 'Sign in').click();
  if (user.totpSecret) {
    cy.location('pathname').should('eq', '/login/2fa');
    cy.task<string>('totp', { secret: user.totpSecret }).then((code) => {
      // Like pasting the code (the input spreads it over the six boxes).
      cy.get('input[autocomplete="one-time-code"]').invoke('val', code).trigger('input');
    });
  }
  cy.location('pathname').should('not.match', /^\/login/);
});

Cypress.Commands.add('cloneUser', (from: string, options = {}) =>
  cy.task<ClonedUser>('db:cloneUser', { from, ...options }),
);

Cypress.Commands.add('projectId', (token: string, name: string) =>
  cy.api<{ id: string; name: string }[]>('GET', '/projects', { token }).then((res) => {
    const project = res.body.find((p) => p.name === name);
    expect(project, `project ${name}`).to.exist;
    return project!.id;
  }),
);

Cypress.Commands.add('createEntry', (token: string, entry: EntryInput) =>
  cy
    .api<Record<string, unknown>>('POST', '/time-entries', {
      token,
      body: {
        projectId: entry.projectId,
        taskId: entry.taskId ?? null,
        description: entry.description ?? '',
        ...(entry.isBillable !== undefined && { isBillable: entry.isBillable }),
        start: { date: entry.date, time: entry.start },
        end: { date: entry.endDate ?? entry.date, time: entry.end },
      },
    })
    .then((res) => {
      expect(res.status, JSON.stringify(res.body)).to.eq(201);
      return res.body;
    }),
);

Cypress.Commands.add('latestMail', (to: string) => {
  const attempt = (left: number): Cypress.Chainable<{ subject: string; text: string }> =>
    cy.task<{ subject: string; text: string } | null>('mail:latest', to).then((mail) => {
      if (mail) return cy.wrap(mail);
      if (left === 0) throw new Error(`no mail to ${to}`);
      return cy.wait(250).then(() => attempt(left - 1));
    });
  return attempt(40);
});

/** A form field by its visible label (works for label[for] and wrapping labels). */
Cypress.Commands.add('findField', (label: string) => {
  // Matches the label's leading text, so a badge after it ("End +1 day") doesn't hide it.
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return cy.contains('label', new RegExp(`^\\s*${escaped}(\\s|$)`)).then(($label) => {
    const id = $label.attr('for');
    return id ? cy.get(`[id="${id}"]`) : cy.wrap($label).find('input,select,textarea').first();
  });
});

export {};
