/** HttpOnly access token cookie — JS o'qiy olmaydi, XSS'da o'g'irlanmaydi. */
export const ACCESS_TOKEN_COOKIE = 'accessToken';

/**
 * Cookie bilan autentifikatsiya qilingan o'zgartiruvchi so'rov (POST/PUT/
 * PATCH/DELETE) shu sarlavhasiz rad etiladi — CSRF himoyasi. Boshqa sayt
 * oddiy `<form>` bilan maxsus sarlavha yubora olmaydi, `fetch` bilan
 * yuborsa esa preflight CORS_ORIGINS'dan o'tmaydi. Qiymati muhim emas.
 */
export const CSRF_HEADER = 'x-requested-with';

/** `Cookie` sarlavhasidan bitta qiymatni o'qiydi (cookie-parser'siz). */
export function readCookie(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  const raw = headers?.cookie;
  const header = Array.isArray(raw) ? raw.join(';') : raw;
  const value = header
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
