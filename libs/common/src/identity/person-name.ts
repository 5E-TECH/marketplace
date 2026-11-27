import { Role } from '../enums';

/**
 * Hujjatlarda qisqa ism (dizayn `hujjat-*`: «Otabek N.»): «Jasur Toshmatov» → «Jasur T.». Frontenddagi
 * `src/shared/lib/personName.ts` bilan aynan bir xil — PDF va ekran bir xil ko‘rinsin. Bitta so‘z yoki harf bilan
 * boshlanmagan qiymat o‘zgarmaydi.
 */
export function shortPersonName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (
    parts.length < 2 ||
    !/^\p{L}/u.test(parts[0]) ||
    !/^\p{L}/u.test(parts[1])
  )
    return name.trim();
  return `${parts[0]} ${parts[1][0].toLocaleUpperCase()}.`;
}

/** Hujjatdagi lavozim: dizayn «Otabek N., omborchi»; boshqa rollar [taklif]. */
export function staffRoleLabel(role: Role | string | null | undefined): string {
  switch (role) {
    case Role.WAREHOUSE:
      return 'omborchi';
    case Role.SUPERADMIN:
      return 'superadmin';
    case Role.ADMIN:
      return 'admin';
    default:
      return '';
  }
}
