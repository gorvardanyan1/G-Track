import type { UpdateOrgSettingsRequest } from '@tempo/shared';
import type { Clock } from '../../lib/clock.ts';
import type { RequestContext } from '../../lib/request-context.ts';
import { AuditAction } from '../audit/audit-actions.ts';
import type { AuditService } from '../audit/audit.service.ts';
import type { AuthContext } from '../auth/auth.types.ts';
import type { OrgSettings, SettingsRepository } from './settings.repository.ts';

/** Organization settings are Super Admin only (enforced by the route). */
export function createSettingsService({
  settings,
  audit,
  clock,
}: {
  settings: SettingsRepository;
  audit: AuditService;
  clock: Clock;
}) {
  return {
    get: () => settings.get(),

    /** Saves only fields that actually change; the audit row lists exactly those. */
    async update(
      actor: AuthContext,
      input: UpdateOrgSettingsRequest,
      context: RequestContext,
    ): Promise<OrgSettings> {
      const current = await settings.get();
      const changed = Object.entries(input).filter(
        ([key, value]) => current[key as keyof OrgSettings] !== value,
      );
      if (changed.length === 0) return current;

      const changes = Object.fromEntries(changed) as UpdateOrgSettingsRequest;
      const saved = await settings.save(changes, actor.userId, clock());
      await audit.record(
        AuditAction.SETTINGS_UPDATED,
        {
          actorId: actor.userId,
          targetType: 'org_settings',
          targetId: '1',
          before: Object.fromEntries(
            changed.map(([key]) => [key, current[key as keyof OrgSettings]]),
          ),
          after: changes,
        },
        context,
      );
      return saved;
    },
  };
}

export type SettingsService = ReturnType<typeof createSettingsService>;
