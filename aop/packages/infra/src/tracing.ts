import { AsyncLocalStorage } from "node:async_hooks";
import { context, propagation, type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { Resource } from "@opentelemetry/resources";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

const INVALID_TRACE_ID = "00000000000000000000000000000000";
const INVALID_SPAN_ID = "0000000000000000";

let tracerProvider: BasicTracerProvider | undefined;
const propagator = new W3CTraceContextPropagator();

const als = new AsyncLocalStorage();
const ROOT_CONTEXT = context.active();

const contextManager = {
  active: () => (als.getStore() ?? ROOT_CONTEXT) as ReturnType<typeof context.active>,
  with: <A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    ctx: ReturnType<typeof context.active>,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> => als.run(ctx, () => fn.call(thisArg, ...args)) as ReturnType<F>,
  bind: <T>(_ctx: ReturnType<typeof context.active>, target: T): T => target,
  enable: () => contextManager,
  disable: () => contextManager,
};

export const initTracing = (serviceName: string): BasicTracerProvider => {
  if (tracerProvider) return tracerProvider;

  context.setGlobalContextManager(contextManager);
  propagation.setGlobalPropagator(propagator);

  tracerProvider = new BasicTracerProvider({
    resource: new Resource({ "service.name": serviceName }),
    spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
  });
  trace.setGlobalTracerProvider(tracerProvider);

  return tracerProvider;
};

export const getTracerProvider = (): BasicTracerProvider | undefined => tracerProvider;

export const getTracer = () => trace.getTracer("@aop/infra");

export const getActiveTraceId = (): string | undefined => {
  const span = trace.getSpan(context.active());
  if (!span) return undefined;
  const traceId = span.spanContext().traceId;
  return traceId === INVALID_TRACE_ID ? undefined : traceId;
};

export const getActiveSpanId = (): string | undefined => {
  const span = trace.getSpan(context.active());
  if (!span) return undefined;
  const spanId = span.spanContext().spanId;
  return spanId === INVALID_SPAN_ID ? undefined : spanId;
};

export const injectTraceHeaders = (headers: Headers | Record<string, string>): Headers => {
  const result = headers instanceof Headers ? new Headers(headers) : new Headers(headers);
  const setter = {
    set: (carrier: Headers, key: string, value: string) => carrier.set(key, value),
  };
  propagator.inject(context.active(), result, setter);
  return result;
};

export const runWithSpan = async <T>(name: string, fn: () => T | Promise<T>): Promise<T> => {
  const tracer = getTracer();
  return tracer.startActiveSpan(name, async (span: Span) => {
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      span.end();
    }
  });
};

export const resetTracing = (): void => {
  if (tracerProvider) {
    tracerProvider.shutdown();
    tracerProvider = undefined;
  }
  context.disable();
  trace.disable();
  propagation.disable();
};
