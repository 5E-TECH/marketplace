import { pathToFileURL } from 'node:url';

export function checkC46Config(env) {
  const missing = [];
  const domain = env.DOMAIN?.trim();
  if (
    !domain ||
    domain.startsWith(':') ||
    domain.includes('/') ||
    domain.endsWith('.localhost') ||
    domain === 'localhost'
  ) {
    missing.push('DOMAIN: public API domeni kerak (HTTP fallback TC2 emas)');
  }
  try {
    if (new URL(env.ALERT_WEBHOOK_URL).protocol !== 'https:') throw new Error();
  } catch {
    missing.push('ALERT_WEBHOOK_URL: HTTPS alert adapter manzili kerak (TC3)');
  }
  if (!env.ELCHI_WEBHOOK_SECRET?.trim())
    missing.push(
      'ELCHI_WEBHOOK_SECRET: yetkazilish webhooki uchun kerak (TC1)',
    );
  return missing;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const missing = checkC46Config(process.env);
  for (const item of missing) console.error(item);
  if (missing.length) process.exitCode = 1;
  else
    console.log(
      'C4.6 konfiguratsiyasi mavjud. TC1–TC4 production dalillari alohida tekshiriladi.',
    );
}
