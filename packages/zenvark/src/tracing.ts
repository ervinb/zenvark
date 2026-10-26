import { trace } from '@opentelemetry/api';

// Looked up per span: a tracer taken at import time stays a no-op if the app
// registers its SDK later through another copy of @opentelemetry/api
export const tracer = () => trace.getTracer('zenvark');
