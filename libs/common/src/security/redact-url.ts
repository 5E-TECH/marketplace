/**
 * Imzolangan havolalar (BE-15 yozuv, BE-30 hujjat, BE-25 CSV chiptasi): token yo‘lda — o‘zi ruxsat yoki ichida filtr
 * (mijoz ismi), shuning uchun logga yozilmaydi.
 */
const SIGNED = /(\/(?:call-recordings|signed-files|exports)\/)[^/?#]+/g;

export function redactUrl(url: string | undefined): string | undefined {
  return url?.replace(SIGNED, '$1[havola]');
}
