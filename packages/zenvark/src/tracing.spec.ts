import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from '@opentelemetry/sdk-trace';
import { afterEach, describe, expect, it } from 'vitest';
import { finishedSpans } from '../test/setup-tracing.ts';
import { tracer } from './tracing.ts';

describe('tracer', () => {
  it('exports spans through the registered provider', () => {
    tracer().startSpan('test').end();

    expect(finishedSpans('test')).toHaveLength(1);
  });

  describe('with an SDK registered through another copy of the API', () => {
    let restore: (() => void) | undefined;

    afterEach(() => {
      restore?.();
    });

    it('exports spans', async () => {
      const apiPath = createRequire(import.meta.url).resolve(
        '@opentelemetry/api',
      );
      const otherApi: typeof import('@opentelemetry/api') = await import(
        `${pathToFileURL(apiPath).href}?copy`
      );
      const exporter = new InMemorySpanExporter();
      otherApi.trace.disable();
      otherApi.trace.setGlobalTracerProvider(
        new TracerProvider({
          spanProcessors: [new SimpleSpanProcessor({ exporter })],
        }),
      );
      restore = () => otherApi.trace.disable();

      tracer().startSpan('test').end();

      expect(exporter.getFinishedSpans()).toHaveLength(1);
    });
  });
});
