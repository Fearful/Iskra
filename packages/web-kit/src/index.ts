export * from './types';
export * from './kernel';
// types.ts also re-exports Kernel (type-only, for features); without this the
// two `export *` collide and TypeScript users could not `new Kernel()`.
export { Kernel } from './kernel';
export { consoleLogger, silentLogger, fromStructuredLogger, type KernelLogger, type StructuredLogger } from './logging';
export type { FeatureRegistry } from './feature-registry';
export * from './driver';
export * from './server';
export * from './router';
export * from './group-router';
export * from './gates';
export * from './client-ip';

// Features
export * from './features/cors';
export * from './features/error-handler';
export * from './features/health';
export * from './features/logger';
export * from './features/request-id';
export * from './features/storage';
export * from './features/db';
export * from './features/cache';
export * from './features/session';
export * from './features/auth';
export * from './features/rate-limit';
export * from './features/permissions';
export * from './features/api-key';
export * from './features/csrf';
export * from './features/validation';
export * from './features/json-schema-validation';
export * from './features/openapi';
export * from './features/upload';
export * from './features/tracing';
export * from './features/email';
export * from './features/sse';
export * from './responses';
export * from './errors';
export * from './contract';
export {
    bindBody,
    bindQuery,
    queryParams,
    readBody,
    matchKeys,
    type BindOptions,
    type ValidationDetails,
    type ValidationIssue,
} from './bind';
export { statusForCode, codeForStatus } from './status-codes';
export {
    describeRoute,
    withRouteDoc,
    routeDocOf,
    toJsonSchema,
    type RouteDescription,
    type ResponseDoc,
    type RouteDocFragment,
    type SchemaInput,
    type JsonSchema,
    type SecurityScheme,
    type NamedScheme,
    type GateSecurity,
} from './route-docs';
export { documentRoutes, type RouteEntry, type RoutesDocument, type RoutesDocumentOptions } from './openapi-routes';
