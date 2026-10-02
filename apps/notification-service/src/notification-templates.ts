/**
 * C6.8 — avtomatik xabarlar shablonlari. Standart matn shu yerda (avval
 * `notification-events.controller.ts` ichida qattiq yozilgan edi); admin
 * tahrirlagani `notification_template` jadvalida saqlanadi va ustun turadi.
 *
 * O'zgaruvchi `{nomi}` ko'rinishida. Shablonda faqat `variables` dagilari
 * ishlatilishi mumkin — saqlashda tekshiriladi.
 */
export interface TemplateDefinition {
  name: string;
  description: string;
  variables: Record<string, string>;
  title: string;
  body: string;
}

export const NOTIFICATION_TEMPLATES = {
  register: {
    name: 'Sotuvchi arizasi qabul qilindi',
    description: 'Sotuvchi ro‘yxatdan o‘tganda unga yuboriladi',
    variables: { shopName: 'Do‘kon nomi', sellerName: 'Sotuvchi ismi' },
    title: 'Arizangiz qabul qilindi',
    body: '{shopName} do‘koni ro‘yxatdan o‘tdi va tasdiqlash uchun yuborildi.',
  },
  shop_approved: {
    name: 'Do‘kon tasdiqlandi',
    description: 'Admin do‘konni tasdiqlaganda sotuvchiga',
    variables: { shopName: 'Do‘kon nomi' },
    title: 'Do‘kon tasdiqlandi',
    body: '{shopName} do‘koningiz faol holatga o‘tdi.',
  },
  shop_rejected: {
    name: 'Do‘kon rad etildi',
    description: 'Admin do‘konni rad etganda sotuvchiga',
    variables: {
      shopName: 'Do‘kon nomi',
      reason: 'Rad etish sababi (bo‘lmasligi mumkin)',
      reasonSentence: '“ Sabab: …” jumlasi; sabab yo‘q bo‘lsa bo‘sh',
    },
    title: 'Do‘kon rad etildi',
    body: '{shopName} do‘koningiz rad etildi.{reasonSentence}',
  },
  product_hidden: {
    name: 'Mahsulot yashirildi',
    description: 'Admin mahsulotni ko‘rinishdan olganda sotuvchiga',
    variables: { productName: 'Mahsulot nomi', reason: 'Sabab' },
    title: 'Mahsulot yashirildi',
    body: '{productName} mahsulotingiz ko‘rinishdan olib tashlandi. Sabab: {reason}',
  },
  order_created: {
    name: 'Yangi buyurtma',
    description: 'Buyurtma tasdiqlanganda xaridor va sotuvchilarga',
    variables: {
      orderNumber: 'Buyurtma raqami',
      totalAmount: 'Buyurtma summasi',
    },
    title: 'Yangi buyurtma',
    body: '{orderNumber} raqamli buyurtma yaratildi.',
  },
  order_cancelled: {
    name: 'Buyurtma bekor qilindi',
    description: 'Admin buyurtmani bekor qilganda',
    variables: { orderId: 'Buyurtma raqami', reason: 'Sabab' },
    title: 'Buyurtma bekor qilindi',
    body: '#{orderId} buyurtma. Sabab: {reason}',
  },
  order_refunded: {
    name: 'Buyurtma puli qaytarildi',
    description: 'Admin buyurtma pulini qaytarganda',
    variables: { orderId: 'Buyurtma raqami', reason: 'Sabab' },
    title: 'Buyurtma puli qaytarildi',
    body: '#{orderId} buyurtma. Sabab: {reason}',
  },
} satisfies Record<string, TemplateDefinition>;

export type TemplateKey = keyof typeof NOTIFICATION_TEMPLATES;

export const isTemplateKey = (key: string): key is TemplateKey =>
  Object.prototype.hasOwnProperty.call(NOTIFICATION_TEMPLATES, key);

const PLACEHOLDER = /\{(\w+)\}/g;

/** Matndagi `{nomi}` o'zgaruvchilari. */
export function placeholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1]);
}

/** `{nomi}` o'zgaruvchilarisiz matn — ortiqcha qavsni topish uchun. */
export function stripPlaceholders(text: string): string {
  return text.replace(PLACEHOLDER, '');
}

/** Qiymati yo'q o'zgaruvchi bo'sh satrga aylanadi. */
export function renderTemplate(
  text: string,
  values: Record<string, unknown>,
): string {
  return text.replace(PLACEHOLDER, (_, name: string) => {
    const value = values[name];
    return value === undefined || value === null ? '' : String(value);
  });
}
