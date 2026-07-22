import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Route'ni auth talab qilmaydigan (ochiq) qilib belgilaydi. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
