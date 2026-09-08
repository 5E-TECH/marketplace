import { applyDecorators, SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Route'ni auth talab qilmaydigan (ochiq) qilib belgilaydi. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PROVIDER_CALLBACK_KEY = 'providerCallback';
/** Provider service validates Basic auth/signatures; JWT must not consume them. */
export const ProviderCallback = () =>
  applyDecorators(Public(), SetMetadata(PROVIDER_CALLBACK_KEY, true));
