import { context, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from '@opentelemetry/sdk-trace';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { redis } from '../test/setup-redis.ts';
import { ConstantBackoff } from './backoffs/constant-backoff.ts';
import { ConsecutiveBreaker } from './breakers/consecutive-breaker.ts';
import { CircuitBreaker } from './circuit-breaker.ts';
import { CircuitState } from './constants.ts';
import { CircuitOpenError } from './errors/circuit-open-error.ts';

describe('CircuitBreaker tracing', () => {
  const exporter = new InMemorySpanExporter();
  const testTracer = trace.getTracer('test');

  const spans = (name: string) =>
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

  afterAll(() => {
    trace.disable();
    context.disable();
  });

  beforeEach(() => {
    exporter.reset();
  });

  const createCircuit = async (check: () => Promise<void>) => {
    const circuit = new CircuitBreaker({
      id: 'test',
      redis,
      breaker: new ConsecutiveBreaker({ threshold: 1 }),
      health: { backoff: new ConstantBackoff({ delayMs: 50 }), check },
      onError: vi.fn(),
    });
    await circuit.start();
    return circuit;
  };

  it('wraps the call in a span between the caller and the call', async () => {
    const circuit = await createCircuit(() => Promise.resolve());

    await testTracer.startActiveSpan('request', async (request) => {
      await circuit.execute(async () => {
        testTracer.startSpan('http').end();
      });
      request.end();
    });
    await circuit.stop();

    const [request] = spans('request');
    const [call] = spans('zenvark.call');
    const [http] = spans('http');
    expect(call?.kind).toBe(SpanKind.CLIENT);
    expect(call?.attributes).toEqual({
      'zenvark.breaker.id': 'test',
      'zenvark.call.result': 'success',
    });
    expect(call?.status.code).toBe(SpanStatusCode.UNSET);
    expect(call?.parentSpanContext?.spanId).toBe(request?.spanContext().spanId);
    expect(http?.parentSpanContext?.spanId).toBe(call?.spanContext().spanId);
  });

  it('marks failed calls, blocked calls, health checks and state changes', async () => {
    let healthy = false;
    const circuit = await createCircuit(() =>
      healthy ? Promise.resolve() : Promise.reject(new Error('down')),
    );

    await expect(
      circuit.execute(() => Promise.reject(new Error('boom'))),
    ).rejects.toThrow();
    await vi.waitUntil(() => circuit.state === CircuitState.OPEN);
    await expect(
      circuit.execute(() => Promise.resolve()),
    ).rejects.toBeInstanceOf(CircuitOpenError);
    await vi.waitUntil(() => spans('zenvark.healthcheck').length > 0);
    healthy = true;
    await vi.waitUntil(() => circuit.state === CircuitState.CLOSED);
    await circuit.stop();

    const [call] = spans('zenvark.call');
    expect(call?.attributes['zenvark.call.result']).toBe('failure');
    expect(call?.status.code).toBe(SpanStatusCode.ERROR);

    const [blocked] = spans('zenvark.blocked');
    expect(blocked?.status.code).toBe(SpanStatusCode.ERROR);

    const checks = spans('zenvark.healthcheck');
    expect(checks[0]?.attributes).toMatchObject({
      'zenvark.healthcheck.type': 'recovery',
      'zenvark.healthcheck.result': 'failure',
    });
    expect(checks[0]?.status.code).toBe(SpanStatusCode.ERROR);
    expect(checks.at(-1)?.attributes['zenvark.healthcheck.result']).toBe(
      'success',
    );
    expect(checks.every((s) => s.parentSpanContext === undefined)).toBe(true);

    expect(
      spans('zenvark.state_change').map(
        (s) => s.attributes['zenvark.circuit.state'],
      ),
    ).toEqual(['open', 'closed']);
  });
});
