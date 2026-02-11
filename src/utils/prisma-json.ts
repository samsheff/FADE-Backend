import { Prisma } from '@prisma/client';

type InputJsonValue = Prisma.InputJsonValue;
const JsonNull = Prisma.JsonNull;

/**
 * Safely convert unknown values to Prisma InputJsonValue
 * Handles null/undefined by mapping to JsonNull
 */
export const toJsonValue = (value: unknown): InputJsonValue => {
  if (value === null || value === undefined) {
    return JsonNull;
  }
  return value as InputJsonValue;
};
