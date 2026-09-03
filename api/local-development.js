import { randomUUID } from "node:crypto";
import { createAuthService } from "./auth-service.js";
import { createApiHandler } from "./http-handler.js";
import { createMemoryAuthRepository } from "./memory-auth-repository.js";
import { createMemoryWarehouseRepository } from "./memory-warehouse-repository.js";
import { createWarehouseService } from "./warehouse-service.js";

const LOCAL_VERIFICATION_CODE = "123456";

export function createLocalDevelopmentApi({ allowedOrigins }) {
  const authService = createAuthService({
    repository: createMemoryAuthRepository(),
    mailer: { sendCode: async () => {} },
    randomInt: () => Number(LOCAL_VERIFICATION_CODE),
    secret: randomUUID(),
  });
  const warehouseService = createWarehouseService({
    repository: createMemoryWarehouseRepository(),
    idGenerator: () => randomUUID(),
  });
  return {
    verificationCode: LOCAL_VERIFICATION_CODE,
    handle: createApiHandler({ authService, warehouseService, allowedOrigins, secureCookies: false }),
  };
}
