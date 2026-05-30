import type { ApiSuccessResponse } from '../types/api.types';

export function successResponse<T>(data: T): ApiSuccessResponse<T> {
  return { success: true, data };
}
