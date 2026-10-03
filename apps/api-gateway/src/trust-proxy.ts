/**
 * Qaysi manzillar "o'zimizning proksi" hisoblanadi — `X-Forwarded-For` ni
 * faqat ulardan qabul qilamiz. Express ro'yxatni o'ngdan (soketdan) chapga
 * yuradi va shu tarmoqlarga TEGISHLI BO'LMAGAN birinchi manzilni `req.ip`
 * deb oladi.
 *
 * Nega bosqichlar soni (`TRUST_PROXY_HOPS`) emas: so'rov API'ga ikki xil
 * yo'l bilan keladi va ularning uzunligi har xil (C4.8 dan keyin topildi):
 *
 *   api.<domen>: mijoz → Cloudflare → cloudflared → caddy → api-gateway
 *   <domen>:     mijoz → Cloudflare → cloudflared → storefront (Next.js
 *                `/api/backend/*` proksisi) → api-gateway
 *
 * Bitta raqam ikkalasiga birdek to'g'ri kelmaydi: storefront kelgan
 * `X-Forwarded-For` ni o'zgartirmay uzatsa, `2` bilan mijoz yozib yuborgan
 * soxta qiymat jurnalga tushardi. Tarmoq bo'yicha ishonch esa zanjir
 * uzunligiga bog'liq emas: ichki Docker tarmog'idagi hamma bosqich
 * (172.16/12) tashlab yuboriladi, birinchi ommaviy manzil — Cloudflare yoki
 * Caddy qo'shgan haqiqiy mijoz IP'si. Mijoz o'zi yozgan qiymatlar undan
 * CHAPDA turadi, shuning uchun ularga navbat yetmaydi. Caddy ham aynan shunday
 * ishlaydi (`trusted_proxies static private_ranges`, deploy/Caddyfile).
 *
 * Ommaviy IP'li proksi (masalan Cloudflare'ning o'zi, tunnelsiz) zanjirga
 * qo'shilsa, uning tarmoqlari shu ro'yxatga ham, Caddy'ga ham qo'shilishi
 * kerak. Batafsil: docs/C4.8-TRUST-PROXY.md
 */
export const TRUSTED_PROXY_RANGES = [
  'loopback', // 127.0.0.1/8, ::1 — lokal dev va serverning o'zi
  'linklocal', // 169.254.0.0/16, fe80::/10
  'uniquelocal', // 10/8, 172.16/12, 192.168/16, fc00::/7 — Docker tarmoqlari
] as const;

export function configureTrustProxy(app: {
  set(setting: string, value: unknown): unknown;
}): void {
  app.set('trust proxy', [...TRUSTED_PROXY_RANGES]);
}
