const apiUrl = process.env.MONITOR_API_URL ?? 'http://localhost:3000/api/v1/health';
const rabbitUrl = process.env.RABBITMQ_MANAGEMENT_URL;
const intervalMs = positiveInt(process.env.MONITOR_INTERVAL_MS, 30_000);
const threshold = positiveInt(process.env.MONITOR_FAILURE_THRESHOLD, 3);
const webhookUrl = process.env.ALERT_WEBHOOK_URL;
const requiredQueues = [
  'echo_queue',
  'identity_queue',
  'catalog_queue',
  'inventory_queue',
  'checkout_queue',
  'payment_queue',
  'finance_queue',
  'integration_queue',
  'notification_queue',
  'search_queue',
  'file_queue',
];

let failures = 0;
let alertOpen = false;

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

async function fetchOk(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response;
}

async function checkRabbitMq() {
  if (!rabbitUrl) return;
  const user = process.env.RABBITMQ_USER ?? 'guest';
  const password = process.env.RABBITMQ_PASSWORD ?? 'guest';
  const auth = Buffer.from(`${user}:${password}`).toString('base64');
  const response = await fetchOk(`${rabbitUrl}/api/queues/%2F`, {
    headers: { authorization: `Basic ${auth}` },
  });
  const queues = await response.json();
  const consumers = new Map(queues.map((queue) => [queue.name, queue.consumers]));
  const down = requiredQueues.filter((name) => !consumers.get(name));
  if (down.length) throw new Error(`consumer yo'q: ${down.join(', ')}`);
}

async function notify(status, detail) {
  const payload = {
    service: 'elchi-marketplace',
    status,
    detail,
    timestamp: new Date().toISOString(),
  };
  console.log(JSON.stringify({ level: status === 'resolved' ? 'info' : 'error', ...payload }));
  if (!webhookUrl) return;
  await fetchOk(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function checkOnce() {
  await fetchOk(apiUrl);
  await checkRabbitMq();
}

async function tick() {
  try {
    await checkOnce();
    if (alertOpen) await notify('resolved', 'API va barcha RabbitMQ consumerlar tiklandi');
    failures = 0;
    alertOpen = false;
    console.log(JSON.stringify({ level: 'info', status: 'healthy', timestamp: new Date().toISOString() }));
  } catch (error) {
    failures += 1;
    const detail = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ level: 'error', status: 'unhealthy', failures, detail }));
    if (failures >= threshold && !alertOpen) {
      alertOpen = true;
      try {
        await notify('firing', detail);
      } catch (notifyError) {
        console.error(JSON.stringify({ level: 'error', status: 'alert_failed', detail: String(notifyError) }));
      }
    }
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await tick();
  setInterval(tick, intervalMs);
}
