import { trace } from '@opentelemetry/api';

// No-op unless the application registers an OpenTelemetry SDK
export const tracer = trace.getTracer('zenvark');
