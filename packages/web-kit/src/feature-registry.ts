import type { ApiKeyFeature } from "./features/api-key";
import type { AuthFeature } from "./features/auth";
import type { CacheFeature } from "./features/cache";
import type { CorsFeature } from "./features/cors";
import type { CsrfFeature } from "./features/csrf";
import type { DbFeature } from "./features/db";
import type { EmailFeature } from "./features/email";
import type { ErrorHandlerFeature } from "./features/error-handler";
import type { HealthCheckFeature } from "./features/health";
import type { JsonSchemaValidationFeature } from "./features/json-schema-validation";
import type { LoggerFeature } from "./features/logger";
import type { OpenAPIFeature } from "./features/openapi";
import type { PermissionsFeature } from "./features/permissions";
import type { RateLimitFeature } from "./features/rate-limit";
import type { RequestIdFeature } from "./features/request-id";
import type { SessionFeature } from "./features/session";
import type { StorageFeature } from "./features/storage";
import type { OtelTracingFeature } from "./features/tracing";
import type { UploadFeature } from "./features/upload";
import type { ValidationFeature } from "./features/validation";

/**
 * The type `kernel.getFeature(name)` returns for each built-in feature name,
 * so features can use each other without casts (`getFeature("cache")?.client`).
 *
 * A feature of your own can be added with declaration merging:
 *
 * ```ts
 * declare module "@iskra-bun/web-kit" {
 *     interface FeatureRegistry {
 *         audit: AuditFeature;
 *     }
 * }
 * ```
 */
export interface FeatureRegistry {
    apiKey: ApiKeyFeature;
    auth: AuthFeature;
    cache: CacheFeature;
    cors: CorsFeature;
    csrf: CsrfFeature;
    // Features only reach the handle; its schema type is the app's concern.
    db: DbFeature<Record<string, unknown>>;
    email: EmailFeature;
    "error-handler": ErrorHandlerFeature;
    health: HealthCheckFeature;
    "json-schema-validation": JsonSchemaValidationFeature;
    logger: LoggerFeature;
    openapi: OpenAPIFeature;
    "otel-tracing": OtelTracingFeature;
    permissions: PermissionsFeature;
    "rate-limit": RateLimitFeature;
    "request-id": RequestIdFeature;
    session: SessionFeature;
    storage: StorageFeature;
    upload: UploadFeature;
    validation: ValidationFeature;
}
