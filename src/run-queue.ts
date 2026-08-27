export interface PendingApproval {
  threadId: string;
  toolCallIds: string[];
}

export function samePending(left: PendingApproval, right: PendingApproval): boolean {
  return left.threadId === right.threadId && left.toolCallIds.length === right.toolCallIds.length
    && left.toolCallIds.every((id, index) => id === right.toolCallIds[index]);
}

/** Return the next unique approval without consuming it. */
export function peekPending(run: { pending: PendingApproval[]; observation?: { pendingApprovals: PendingApproval[] } }): PendingApproval | undefined {
  return run.pending[0] ?? run.observation?.pendingApprovals.find((item) => !run.pending.some((live) => samePending(live, item)));
}

/** Consume one exact approval only after its continuation was accepted. */
export function consumePending(run: { pending: PendingApproval[]; observation?: { pendingApprovals: PendingApproval[] } }, target: PendingApproval): void {
  run.pending = run.pending.filter((item) => !samePending(item, target));
  if (run.observation) run.observation.pendingApprovals = run.observation.pendingApprovals.filter((item) => !samePending(item, target));
}

export function enqueuePending(queue: PendingApproval[], item: PendingApproval): void {
  if (!queue.some((queued) => samePending(queued, item))) queue.push(item);
}
