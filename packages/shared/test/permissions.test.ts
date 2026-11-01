import { describe, expect, it } from 'vitest';
import { projectPermissions, resolveProjectAccess, type ProjectAccess } from '../src/index.ts';

describe('resolveProjectAccess', () => {
  it.each([
    ['SUPER_ADMIN', null, 'admin'],
    ['SUPER_ADMIN', 'WORKER', 'admin'],
    ['PROJECT_MANAGER', 'PM', 'manager'],
    ['PROJECT_MANAGER', 'WORKER', 'member'],
    ['PROJECT_MANAGER', null, null],
    ['WORKER', 'WORKER', 'member'],
    // A demoted PM keeps the membership row but loses management rights.
    ['WORKER', 'PM', 'member'],
    ['WORKER', null, null],
  ] as const)('%s with membership %s → %s', (role, membership, expected) => {
    expect(resolveProjectAccess(role, membership)).toBe(expected);
  });
});

describe('projectPermissions', () => {
  const table: [keyof typeof projectPermissions, ProjectAccess[]][] = [
    ['editDetails', ['admin']],
    ['archive', ['admin']],
    ['managePms', ['admin']],
    ['editBudget', ['admin', 'manager']],
    ['manageWorkers', ['admin', 'manager']],
    ['manageTasks', ['admin', 'manager']],
    ['viewMembersAndRates', ['admin', 'manager']],
  ];
  it.each(table)('%s is allowed for %j only', (permission, allowed) => {
    for (const access of ['admin', 'manager', 'member'] as const) {
      expect(projectPermissions[permission](access)).toBe(allowed.includes(access));
    }
  });
});
