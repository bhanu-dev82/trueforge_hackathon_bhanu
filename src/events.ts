import type { TrueForgeApi } from '@truefoundry/trueforge-sdk';

export type PipelineStage = 'idle' | 'hunter' | 'surgeon' | 'insurance' | 'approval' | 'done' | 'error';

export interface HarnessEvent {
  at: string;
  kind:
    | 'log'
    | 'model'
    | 'delta'
    | 'sandbox'
    | 'thread'
    | 'tool'
    | 'approval'
    | 'metrics'
    | 'done'
    | 'error';
  text?: string;
  threadId?: string;
  title?: string;
  sandboxId?: string;
  toolCallIds?: string[];
  modelFqn?: string;
  status?: string;
  metrics?: TrueForgeApi.TurnMetrics;
  stage?: PipelineStage;
}

export interface TurnObservation {
  outputText: string;
  sandboxIds: string[];
  threads: Array<{ threadId: string; title: string }>;
  pendingApprovals: Array<{ threadId: string; toolCallIds: string[] }>;
  metrics?: TrueForgeApi.TurnMetrics;
  status: string;
  events: HarnessEvent[];
}

export function unwrapTurnEvent(item: unknown): TrueForgeApi.TurnStreamingEvent | undefined {
  if (!item || typeof item !== 'object') {
    return undefined;
  }
  const rec = item as Record<string, unknown>;
  if (typeof rec.type === 'string') {
    return item as TrueForgeApi.TurnStreamingEvent;
  }
  if (rec.data && typeof rec.data === 'object' && typeof (rec.data as { type?: string }).type === 'string') {
    return rec.data as TrueForgeApi.TurnStreamingEvent;
  }
  return undefined;
}

export function stageFromThreadTitle(title: string): PipelineStage | undefined {
  const t = title.toLowerCase();
  if (t.includes('hunter')) return 'hunter';
  if (t.includes('surgeon')) return 'surgeon';
  if (t.includes('insurance')) return 'insurance';
  return undefined;
}

export function observeTurn(): {
  feed(event: TrueForgeApi.TurnStreamingEvent): HarnessEvent[];
  snapshot(): TurnObservation;
} {
  const events: HarnessEvent[] = [];
  let outputText = '';
  const sandboxIds: string[] = [];
  const threads: Array<{ threadId: string; title: string }> = [];
  const pendingApprovals: Array<{ threadId: string; toolCallIds: string[] }> = [];
  let metrics: TrueForgeApi.TurnMetrics | undefined;
  let status = 'running';

  const push = (event: HarnessEvent): HarnessEvent => {
    events.push(event);
    return event;
  };

  return {
    feed(event: TrueForgeApi.TurnStreamingEvent): HarnessEvent[] {
      const emitted: HarnessEvent[] = [];
      switch (event.type) {
        case 'model.message.delta': {
          const chunk = event.content ?? '';
          if (chunk && event.threadId === 'main') {
            outputText += chunk;
            emitted.push(
              push({
                at: event.createdAt ?? new Date().toISOString(),
                kind: 'delta',
                text: chunk,
                threadId: event.threadId,
              }),
            );
          }
          break;
        }
        case 'sandbox.created':
          sandboxIds.push(event.sandboxId);
          emitted.push(
            push({
              at: event.createdAt,
              kind: 'sandbox',
              sandboxId: event.sandboxId,
              text: `sandbox ${event.sandboxId}`,
              stage: 'hunter',
            }),
          );
          break;
        case 'thread.created':
          threads.push({ threadId: event.threadId, title: event.title });
          emitted.push(
            push({
              at: event.createdAt,
              kind: 'thread',
              threadId: event.threadId,
              title: event.title,
              text: event.title,
              stage: stageFromThreadTitle(event.title),
            }),
          );
          break;
        case 'tool.response':
          emitted.push(
            push({
              at: event.createdAt,
              kind: 'tool',
              threadId: event.threadId,
              text: `tool ${event.toolCallId}`,
            }),
          );
          break;
        case 'tool.approval_required': {
          const ids = event.toolCalls.map((call) => call.id);
          pendingApprovals.push({ threadId: event.threadId, toolCallIds: ids });
          emitted.push(
            push({
              at: event.createdAt,
              kind: 'approval',
              threadId: event.threadId,
              toolCallIds: ids,
              text: `approval required for ${ids.length} tool call(s)`,
              stage: 'approval',
            }),
          );
          break;
        }
        case 'turn.done': {
          status = event.state.status;
          if (event.state.status === 'done') {
            metrics = event.state.metrics;
            const finalText = event.state.output?.content;
            if (typeof finalText === 'string' && finalText.length > outputText.length) {
              outputText = finalText;
            } else if (Array.isArray(finalText) && outputText.length === 0) {
              outputText = JSON.stringify(finalText);
            }
          }
          if (event.state.status === 'error') {
            emitted.push(
              push({
                at: event.createdAt,
                kind: 'error',
                text: event.state.message,
                status: 'error',
                stage: 'error',
              }),
            );
          } else {
            emitted.push(
              push({
                at: event.createdAt,
                kind: 'done',
                status: event.state.status,
                metrics,
                stage: pendingApprovals.length ? 'approval' : 'done',
                text: event.state.status,
              }),
            );
          }
          break;
        }
        default:
          break;
      }
      return emitted;
    },
    snapshot(): TurnObservation {
      return { outputText, sandboxIds, threads, pendingApprovals, metrics, status, events };
    },
  };
}

export function formatTokenomics(metrics: TrueForgeApi.TurnMetrics | undefined, modelFqn: string): string {
  if (!metrics) {
    return `model=${modelFqn} (no metrics on this turn)`;
  }
  const input = metrics.totalInputTokens ?? 0;
  const cache = metrics.totalCacheReadTokens ?? 0;
  const cachePct = input > 0 ? ((cache / input) * 100).toFixed(1) : '0.0';
  return [
    `model=${modelFqn}`,
    `tokens=${metrics.totalTokens ?? 0} (in ${input} / out ${metrics.totalOutputTokens ?? 0})`,
    `cache-read=${cache} (${cachePct}% of input)`,
    metrics.totalCostInUsd != null ? `est-usd=${metrics.totalCostInUsd.toFixed(4)}` : undefined,
  ]
    .filter(Boolean)
    .join(' | ');
}
