import type { DatabaseDefinition } from '@app/common';
import { CreateAuthSession1721908800000 } from './migrations/1721908800000-create-auth-session';
import { CreateUsers1722776400000 } from './migrations/1722776400000-create-users';
import { AddUserShopOperator1722950000000 } from './migrations/1722950000000-add-user-shop-operator';
import { AddUserIsBlocked1722950000001 } from './migrations/1722950000001-add-user-is-blocked';
import { CreateActivityLog1722950000002 } from './migrations/1722950000002-create-activity-log';
import { CreateRecoverySupport1723100000000 } from './migrations/1723100000000-create-recovery-support';
import { CreatePlatformSettings1725897600000 } from './migrations/1725897600000-create-platform-settings';
import { AddUserAuthVersion1725984000000 } from './migrations/1725984000000-add-user-auth-version';
import { MoneyToBigint1795219200000 } from './migrations/1795219200000-money-to-bigint';
import { NewRoles1795996800000 } from './migrations/1795996800000-new-roles';
import { User } from './entities/user.entity';
import { AuthSession } from './entities/auth-session.entity';
import { ActivityLog } from '@app/common';
import { PlatformSettings } from './entities/platform-settings.entity';

/**
 * identity-service bazasi (BE-04): sxema, entity va migratsiyalar bitta joyda — modul (`identity.module.ts`) va migratsiya CLI
 * (`migrate.ts`) shu ro‘yxatdan foydalanadi. Yangi migratsiya shu yerga qo‘shiladi.
 */
export const IDENTITY_DB: DatabaseDefinition = {
  schema: 'identity',
  entities: [User, AuthSession, ActivityLog, PlatformSettings],
  migrations: [
    CreateAuthSession1721908800000,
    CreateUsers1722776400000,
    AddUserShopOperator1722950000000,
    AddUserIsBlocked1722950000001,
    CreateActivityLog1722950000002,
    CreateRecoverySupport1723100000000,
    CreatePlatformSettings1725897600000,
    AddUserAuthVersion1725984000000,
    MoneyToBigint1795219200000,
    NewRoles1795996800000,
  ],
};
