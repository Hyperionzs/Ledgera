import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiError } from '@ledgera/shared';

/**
 * Global exception filter — normalizes every error into the shared ApiError shape.
 * Maps Prisma errors to stable domain codes.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status: number;
    let code: string;
    let message: string;
    let details: Record<string, unknown> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null && 'message' in body) {
        const { message: m, field } = body as { message?: unknown; field?: string };
        message = Array.isArray(m) ? String(m[0]) : String(m ?? exception.message);
        details = field ? { field } : undefined;
      } else {
        message = typeof body === 'string' ? body : exception.message;
      }
      code = this.codeForStatus(status, message);
    } else {
      // Prisma / unknown errors
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      code = 'INTERNAL_ERROR';
      message = 'Terjadi kesalahan pada server';
      this.logger.error(exception instanceof Error ? exception.stack : exception);
    }

    const payload: ApiError = {
      success: false,
      error: { code, message, details },
      timestamp: new Date().toISOString(),
    };

    response.status(status).json(payload);
  }

  private codeForStatus(status: number, message: string): string {
    if (message.includes('Missing access token')) return 'UNAUTHORIZED';
    if (message.includes('Invalid or expired')) return 'UNAUTHORIZED';
    if (message.includes('Session no longer active')) return 'UNAUTHORIZED';
    if (message.includes('Account is disabled')) return 'ACCOUNT_DISABLED';
    if (message.includes('Requires role')) return 'FORBIDDEN';
    if (status === HttpStatus.FORBIDDEN) return 'FORBIDDEN';
    if (status === HttpStatus.UNAUTHORIZED) return 'UNAUTHORIZED';
    if (status === HttpStatus.NOT_FOUND) return 'NOT_FOUND';
    if (status === HttpStatus.CONFLICT) return 'CONFLICT';
    if (status === HttpStatus.BAD_REQUEST) return 'VALIDATION_FAILED';
    return 'ERROR';
  }
}
