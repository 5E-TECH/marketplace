import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const apiUrl =
  process.env.MONITOR_API_URL ??
  'http://localhost:3000/api/v1/health/readiness';
const rabbitUrl = process.env.RABBITMQ_MANAGEMENT_URL;
// BE-13 TC10: sotuvchi sahifasi (Storefront `landing/`, `/healthz`) — domen EQ-05 dan keyin beriladi; bo‘sh — tekshirilmaydi
const landingUrl = process.env.MONITOR_LANDING_URL;
const intervalMs = positiveInt(process.env.MONITOR_INTERVAL_MS, 30_000);
const threshold = positiveInt(process.env.MONITOR_FAILURE_THRESHOLD, 3);
const webhookUrl = process.env.ALERT_WEBHOOK_URL;
// BE-02: `_v2` — DLQ argumentlari bilan yangi navbatlar (libs/common/src/messaging/rmq.util.ts RmqQueue bilan bir xil)
const requiredQueues = [
  'identity_queue_v2',
  'catalog_queue_v2',
  'inventory_queue_v2',
  'checkout_queue_v2',
  'payment_queue_v2',
  'finance_queue_v2',
  'integration_queue_v2',
  'notification_queue_v2',
  'search_queue_v2',
  'file_queue_v2',
  'lead_queue_v2',
];

// BE-26 (T8 «Kuzatuv»): ko'rsatkich ogohlantirishlari — gateway `GET /health/ops` (MONITOR_TOKEN bilan).
const opsToken = process.env.MONITOR_OPS_TOKEN;
const opsUrl =
  process.env.MONITOR_OPS_URL ??
  apiUrl.replace(/\/health\/readiness$/, '/health/ops');
// Karta BE-26 TC3: «Elchi xatolari 5 daqiqada 10 dan oshdi → ogohlantirish»
const elchiErrorsMax = positiveInt(process.env.MONITOR_ELCHI_ERRORS_5M_MAX, 10);
// TZ 1-bo'lim KPI (6-oy): birinchi qo'ng'iroqqacha median ≤ 10 daqiqa — eng eski lid shundan ko'p kutsa [taklif]
const leadQueueMaxAge = positiveInt(
  process.env.MONITOR_LEAD_QUEUE_MAX_AGE_MIN,
  10,
);
/** Ochiq ko'rsatkich ogohlantirishlari: nom → true (takror yuborilmaydi, me'yorga qaytsa «hal bo'ldi»). */
const openConditions = new Map();
/** `health/ops` ketma-ket o'qilmagan marta (noto'g'ri token — 404, gateway yo'q): chegaradan keyin ogohlantirish. */
let opsFailures = 0;

let failures = 0;
let alertOpen = false;
// BE-02: DLQ ogohlantirishi alohida — u ochiq turganda API yoki consumer uzilishi ogohlantirishi bosilmasin
let deadLetterAlertOpen = false;
let deadLetterDetail = '';

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

async function fetchOk(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok)
    throw new Error(`HTTP ${response.status} from ${new URL(url).origin}`);
  return response;
}

async function checkRabbitMq() {
  if (!rabbitUrl) return [];
  const user = process.env.RABBITMQ_USER ?? 'guest';
  const password = process.env.RABBITMQ_PASSWORD ?? 'guest';
  const auth = Buffer.from(`${user}:${password}`).toString('base64');
  const response = await fetchOk(`${rabbitUrl}/api/queues/%2F`, {
    headers: { authorization: `Basic ${auth}` },
  });
  const queues = await response.json();
  const consumers = new Map(
    queues.map((queue) => [queue.name, queue.consumers]),
  );
  const down = requiredQueues.filter((name) => !consumers.get(name));
  if (down.length) throw new Error(`consumer yo'q: ${down.join(', ')}`);
  // BE-02: ishlanmagan xabar DLQ ga tushadi — sog'liqdan alohida qaytariladi
  return queues
    .filter((queue) => queue.name.endsWith('.dlq') && queue.messages > 0)
    .map((queue) => `${queue.name} (${queue.messages})`);
}

async function notify(status, detail) {
  const payload = {
    service: 'elchi-marketplace',
    status,
    detail,
    timestamp: new Date().toISOString(),
  };
  console.log(
    JSON.stringify({
      level: status.endsWith('resolved') ? 'info' : 'error',
      ...payload,
    }),
  );
  if (!webhookUrl) return;
  await fetchOk(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  console.log(
    JSON.stringify({
      level: 'info',
      status: 'alert_delivered',
      alertStatus: status,
      timestamp: payload.timestamp,
    }),
  );
}

/** Sotuvchi sahifasi javob bermasa — xato (asosiy ogohlantirish bilan bir xil). */
async function checkLanding() {
  if (!landingUrl) return;
  try {
    await fetchOk(landingUrl);
  } catch (error) {
    throw new Error(
      `sotuvchi sahifasi: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** API, consumerlar va sotuvchi sahifasi sog'ligi; yiqilsa xato. Natija — xabari bor DLQ lar (alohida ogohlantirish). */
export async function checkOnce() {
  await fetchOk(apiUrl);
  const deadLetters = await checkRabbitMq();
  await checkLanding();
  return deadLetters;
}

/** BE-02: DLQ da xabar paydo bo'lsa — `dlq_firing`, bo'shasa — `dlq_resolved` (asosiy ogohlantirishdan mustaqil). */
async function checkDeadLetters(deadLetters) {
  const detail = deadLetters.length
    ? `DLQ da xabar bor: ${deadLetters.join(', ')}`
    : '';
  // Takror ogohlantirish faqat DLQ lar ro'yxati o'zgarsa (xabar soni o'sishi emas)
  const key = deadLetters.map((entry) => entry.split(' (')[0]).join(',');
  const status = detail ? 'dlq_firing' : 'dlq_resolved';
  if (
    detail
      ? deadLetterAlertOpen && key === deadLetterDetail
      : !deadLetterAlertOpen
  )
    return;
  try {
    await notify(status, detail || "DLQ lar bo'sh");
    deadLetterAlertOpen = Boolean(detail);
    deadLetterDetail = key;
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        status: 'alert_failed',
        detail: String(error),
      }),
    );
  }
}

/** Bitta ko'rsatkich sharti: buzilsa — `<nom>_firing` (bir marta), me'yorga qaytsa — `<nom>_resolved`. */
async function condition(name, breached, detail, resolvedDetail) {
  const open = openConditions.get(name) === true;
  if (breached === open) return;
  try {
    await notify(
      `${name}_${breached ? 'firing' : 'resolved'}`,
      breached ? detail : resolvedDetail,
    );
    openConditions.set(name, breached);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        status: 'alert_failed',
        detail: String(error),
      }),
    );
  }
}

/** BE-26: Elchi API xatolari va lid navbati. Token berilmasa — tekshirilmaydi; o'qilmasa — o'tkazib yuboriladi. */
export async function checkOps() {
  if (!opsToken) return;
  let data;
  try {
    const response = await fetchOk(opsUrl, {
      headers: { 'x-monitor-token': opsToken },
    });
    const body = await response.json();
    data = body?.data ?? body;
  } catch (error) {
    opsFailures += 1;
    console.error(
      JSON.stringify({
        level: 'warn',
        status: 'ops_unavailable',
        failures: opsFailures,
        detail: String(error),
      }),
    );
    // jim o'chib qolmasin: token xato yoki servis yo'q bo'lsa ham ogohlantirish (TC3 ishlamay qolgani bilinsin)
    await condition(
      'ops_unavailable',
      opsFailures >= threshold,
      `health/ops o'qilmadi (${opsFailures} marta): ${String(error)}`,
      'health/ops tiklandi',
    );
    return;
  }
  opsFailures = 0;
  await condition('ops_unavailable', false, '', 'health/ops tiklandi');
  const errors = data?.elchiApiErrors5m;
  if (typeof errors === 'number')
    await condition(
      'elchi_errors',
      errors > elchiErrorsMax,
      `Elchi API xatolari 5 daqiqada ${errors} (chegara ${elchiErrorsMax})`,
      'Elchi API xatolari me’yorda',
    );
  const queue = data?.leadQueue;
  if (queue && 'oldestMinutes' in queue)
    await condition(
      'lead_queue',
      typeof queue.oldestMinutes === 'number' &&
        queue.oldestMinutes > leadQueueMaxAge,
      `Navbatda lid ${queue.oldestMinutes} daqiqadan beri qo‘ng‘iroqsiz (kutyapti: ${queue.waiting}; chegara ${leadQueueMaxAge} daq)`,
      'Lid navbati me’yorda',
    );
}

export async function tick() {
  await checkOps();
  let healthError;
  let deadLetters = null;
  try {
    deadLetters = await checkOnce();
  } catch (error) {
    healthError = error;
  }
  if (deadLetters) await checkDeadLetters(deadLetters);
  if (healthError) {
    failures += 1;
    const detail =
      healthError instanceof Error ? healthError.message : String(healthError);
    console.error(
      JSON.stringify({ level: 'error', status: 'unhealthy', failures, detail }),
    );
    if (failures >= threshold && !alertOpen) {
      try {
        await notify('firing', detail);
        // Mark delivered only after success, so a failed webhook is retried.
        alertOpen = true;
      } catch (error) {
        console.error(
          JSON.stringify({
            level: 'error',
            status: 'alert_failed',
            detail: String(error),
          }),
        );
      }
    }
    return;
  }
  failures = 0;
  if (alertOpen) {
    try {
      await notify(
        'resolved',
        'API, sotuvchi sahifasi va barcha RabbitMQ consumerlar tiklandi',
      );
      alertOpen = false;
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          status: 'alert_failed',
          detail: String(error),
        }),
      );
    }
  }
  console.log(
    JSON.stringify({
      level: 'info',
      status: 'healthy',
      timestamp: new Date().toISOString(),
    }),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (!opsToken) {
    console.error(
      JSON.stringify({
        level: 'warn',
        status: 'ops_unconfigured',
        detail:
          'MONITOR_OPS_TOKEN yo‘q: Elchi xatolari va lid navbati tekshirilmaydi (BE-26)',
      }),
    );
  }
  if (!webhookUrl) {
    console.error(
      JSON.stringify({
        level: 'warn',
        status: 'alert_unconfigured',
        detail: 'ALERT_WEBHOOK_URL yo‘q: faqat lokal log yoziladi',
      }),
    );
  }
  // Await each check to prevent overlapping requests and duplicate alerts.
  while (true) {
    await tick();
    await sleep(intervalMs);
  }
}
