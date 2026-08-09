import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import * as bcrypt from 'bcryptjs';

/**
 * Reusable hashing — password (bcryptjs) and token digests (sha256).
 * bcryptjs is pure JS: no native build step, install works anywhere.
 */
@Injectable()
export class HashService {
  private readonly rounds = 10;

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.rounds);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /** One-way digest for refresh tokens — stored in DB instead of raw token. */
  sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
