export const AuditAction = {
  LOGIN_SUCCEEDED: 'auth.login.succeeded',
  LOGIN_FAILED: 'auth.login.failed',
  ACCOUNT_LOCKED: 'auth.account.locked',
  TWO_FACTOR_FAILED: 'auth.2fa.failed',
  TWO_FACTOR_ENABLED: 'auth.2fa.enabled',
  TWO_FACTOR_DISABLED: 'auth.2fa.disabled',
  RECOVERY_CODE_USED: 'auth.2fa.recovery_code_used',
  REFRESH_TOKEN_REUSED: 'auth.refresh_token.reuse_detected',
  LOGOUT: 'auth.logout',
  LOGOUT_ALL: 'auth.logout_all',
  INVITE_CREATED: 'auth.invite.created',
  INVITE_ACCEPTED: 'auth.invite.accepted',
  PASSWORD_RESET_REQUESTED: 'auth.password_reset.requested',
  PASSWORD_RESET_COMPLETED: 'auth.password_reset.completed',
  PASSWORD_CHANGED: 'auth.password_changed',
  PROFILE_UPDATED: 'auth.profile_updated',

  INVITE_REVOKED: 'user.invite.revoked',
  USER_ROLE_CHANGED: 'user.role_changed',
  USER_DEACTIVATED: 'user.deactivated',
  USER_ACTIVATED: 'user.activated',
  USER_SESSIONS_REVOKED: 'user.sessions_revoked',

  CLIENT_CREATED: 'client.created',
  CLIENT_UPDATED: 'client.updated',
  CLIENT_ARCHIVED: 'client.archived',
  CLIENT_UNARCHIVED: 'client.unarchived',

  PROJECT_CREATED: 'project.created',
  PROJECT_UPDATED: 'project.updated',
  PROJECT_ARCHIVED: 'project.archived',
  PROJECT_UNARCHIVED: 'project.unarchived',
  MEMBER_ADDED: 'project.member_added',
  MEMBER_UPDATED: 'project.member_updated',
  MEMBER_REMOVED: 'project.member_removed',
  TASK_CREATED: 'task.created',
  TASK_UPDATED: 'task.updated',
  TASK_DELETED: 'task.deleted',

  TIME_ENTRY_CREATED: 'time_entry.created',
  TIME_ENTRY_UPDATED: 'time_entry.updated',
  TIME_ENTRY_DELETED: 'time_entry.deleted',
  TIME_ENTRY_AUTO_STOPPED: 'time_entry.auto_stopped',

  TIMESHEET_SUBMITTED: 'timesheet.submitted',
  TIMESHEET_APPROVED: 'timesheet.approved',
  TIMESHEET_REJECTED: 'timesheet.rejected',

  SETTINGS_UPDATED: 'settings.updated',
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];
