import { Injectable } from '@nestjs/common';
import { APP } from '@nexuspos/shared';

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
