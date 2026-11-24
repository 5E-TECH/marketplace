import { Role } from '../enums';

/**
 * BE-25 (FE-09, FE-16, FE-26): foydalanuvchi ismi va roli ID bo‘yicha — ekranlarda `#ID` o‘rniga ism (operator, omborchi,
 * sotuvchi). Faqat ichki RPC (identity). O‘chirilgan foydalanuvchi ham qaytadi (tarixda ism qolsin); telefon, email yo‘q.
 */
export const IDENTITY_USER_NAMES = 'identity.user.names';

/** Bitta so‘rovda eng ko‘p ID. */
export const USER_NAMES_LIMIT = 500;

export interface UserNameRow {
  id: string;
  /** Ism kiritilmagan — null. */
  name: string | null;
  role: Role;
}
