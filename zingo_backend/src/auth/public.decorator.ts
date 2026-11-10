import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';

/** Marks a route that does not need a login token. Everything else is protected. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
