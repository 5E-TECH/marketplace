/** Imzolangan havolalar (BE-15 yozuv, BE-30 hujjat): token yo‘lda — o‘zi ruxsat, shuning uchun logga yozilmaydi. */
const SIGNED = /(\/(?:call-recordings|signed-files)\/)[^/?#]+/g;

export function redactUrl(url: string | undefined): string | undefined {
  return url?.replace(SIGNED, '$1[havola]');
}
