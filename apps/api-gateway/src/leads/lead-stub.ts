import { NotImplementedException } from '@nestjs/common';

export const NOT_IMPLEMENTED = 'NOT_IMPLEMENTED';

/**
 * BE-25 shartnomasi: endpoint OpenAPI da e’lon qilingan, real kod keyingi kartada.
 * 501 va barqaror `errorCode` qaytaradi (AllExceptionsFilter maxsus kodni saqlaydi).
 * Real kod stubni almashtirganda yo‘l, metod nomi, DTO va Swagger dekoratorlari o‘zgarmaydi.
 */
export function notImplementedYet(card: string): never {
  throw new NotImplementedException({
    message: `Hali qurilmagan: ${card} da quriladi`,
    errorCode: NOT_IMPLEMENTED,
  });
}
