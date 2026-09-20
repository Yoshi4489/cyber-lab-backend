import { z } from 'zod';
import { ErrorCodes } from '../lib/errors.js';

export const errorBody = z.object({
  code: z.enum(ErrorCodes),
  message: z.string(),
  correlationId: z.uuid(),
});

// These include framework errors, such as malformed JSON and global rate limits.
export const errorResponses = {
  400: errorBody,
  401: errorBody,
  403: errorBody,
  404: errorBody,
  413: errorBody,
  415: errorBody,
  429: errorBody,
  500: errorBody,
};

export const serviceTokenSecurity = [{ serviceToken: [] as string[] }];
