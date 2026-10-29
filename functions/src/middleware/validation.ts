import { z } from 'zod';
import { HttpsError } from 'firebase-functions/v2/https';

export function validate<T extends z.ZodTypeAny>(schema: T, data: unknown): z.output<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join(', ');
    throw new HttpsError('invalid-argument', message);
  }
  return result.data;
}
