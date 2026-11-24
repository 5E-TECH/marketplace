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
  cod_reconciliation_mismatch: {
    name: 'Sverka farqi',
    description:
      'BE-21 (TZ ELC-4): kunlik COD sverkasida Elchi o‘tkazmasi buyurtma bilan mos kelmasa — moliya va nazoratchiga',
    variables: {
      date: 'Sana',
      mismatchCount: 'Mos kelmagan buyurtmalar soni',
      diffTotal: 'Farq jami, so‘m (kelgan − kutilgan)',
    },
    title: 'Sverka farqi: {date}',
    body: '{date}: Elchi o‘tkazmasi {mismatchCount} ta buyurtmada mos emas, farq {diffTotal} so‘m. Moliya → kunlik sverka.',
  },
  elchi_status_conflict: {
    name: 'Elchi holati buyurtmaga zid',
    description:
      'BE-21: Elchi xabari buyurtma holatiga zid (yetkazilgan sotuvni bekor qildi, rad etilganini «sotildi» dedi va h.k.) — buyurtma o‘zgarmaydi, moliya va nazoratchiga',
    variables: {
      orderId: 'Buyurtma raqami',
      orderStatus: 'Buyurtma holati',
      elchiStatus: 'Elchi holati',
    },
    title: 'Elchi holati zid: buyurtma {orderId}',
    body: 'Buyurtma {orderId} ({orderStatus}) — Elchi «{elchiStatus}» yubordi. Holat o‘zgarmadi. Pul va holatni qo‘lda tekshiring.',
  },
  elchi_check_mismatch: {
    name: 'Elchi tekshiruvida farq',
    description:
      'BE-46 (TZ ELC-4; ega qarori 2026-11-24 «Avtomatik so‘rov»): kunlik avtomatik Elchi tekshiruvida yangi farq (holat yoki pul) — moliya va nazoratchiga',
    variables: {
      date: 'Sana',
      newDiffCount: 'Yangi farqlar soni',
      openDiffCount: 'Ochiq farqlar jami',
      orders: 'Buyurtmalar (birinchi 20 tasi)',
    },
    title: 'Elchi tekshiruvi: {date} — {newDiffCount} ta yangi farq',
    body: '{date}: Elchi bilan tekshiruvda {newDiffCount} ta posilkada yangi farq (jami ochiq {openDiffCount}): {orders}. Moliya → Elchi sverkasi.',
  },

  lot_blocked: {
    name: 'Partiya sotuvdan chiqdi (muddat)',
    description:
      'BE-17 (TZ OMB-3): yaroqlilik muddatiga 60 kundan kam qolgan partiya sotuvga chiqmaydi — admin va superadminga',
    variables: {
      count: 'Partiyalar soni',
      list: 'Partiyalar (SKU, partiya, muddat, soni)',
    },
    title: 'Muddati yaqin tovar sotuvdan chiqdi: {count} partiya',
    body: '{list}. Optovikka qaytarish yoki hisobdan chiqarishni hal qiling.',
  },
  price_orange: {
    name: 'To‘q sariq narx tasdiqlandi',
    description:
      'BE-09 (TZ 2.6): admin zararli (to‘q sariq) narxni sabab bilan tasdiqlaganda superadminlarga',
    variables: {
      productName: 'Mahsulot nomi',
      price: 'Tasdiqlangan narx',
      recommended: 'Tavsiya narx',
      reason: 'Sabab',
    },
    title: 'To‘q sariq narx tasdiqlandi',
    body: '{productName}: {price} so‘m (tavsiya {recommended}). Sabab: {reason}',
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
