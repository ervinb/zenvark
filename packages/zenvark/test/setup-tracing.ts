import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from '@opentelemetry/sdk-trace';
import { afterAll, beforeAll, beforeEach } from 'vitest';

export const exporter = new InMemorySpanExporter();

export const finishedSpans = (name: string) =>
  exporter.getFinishedSpans().filter((s) => s.name === name);

beforeAll(() => {
  context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable(),
  );
  trace.setGlobalTracerProvider(
    new TracerProvider({
      spanProcessors: [new SimpleSpanProcessor({ exporter })],
    }),
  );
});

beforeEach(() => {
  exporter.reset();
});

afterAll(() => {
  trace.disable();
  context.disable();
});
