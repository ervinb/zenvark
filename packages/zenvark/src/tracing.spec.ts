import { describe, expect, it } from 'vitest';
import { finishedSpans } from '../test/setup-tracing.ts';
import { tracer } from './tracing.ts';

describe('tracer', () => {
  it('exports spans through the registered provider', () => {
    tracer.startSpan('test').end();

    expect(finishedSpans('test')).toHaveLength(1);
  });
});
