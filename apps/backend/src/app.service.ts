import { Injectable } from '@nestjs/common';
import { APP } from '@ledgera/shared';

@Injectable()
export class AppService {
  getAppInfo() {
    return {
      name: APP.NAME,
      version: APP.VERSION,
      description: APP.DESCRIPTION,
      timestamp: new Date().toISOString(),
    };
  }
}
