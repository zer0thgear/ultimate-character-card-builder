'use client';

import type { LlmConnection, LlmMessage } from '@/types/llm';
import { useLlmStore } from '@/store/llmStore';
import { useLoreWizardStore } from '@/store/loreWizardStore';
import { llmCall, type LlmCallOptions, type LlmCallResult } from '@/components/llm/llmCall';

// One lorebook-wizard call (components/llm/llmCall.ts): the Planner's or
// the Writer's own connection, else the writing assistant's.

export type WizardRole = 'planner' | 'writer';

/** The connection a role uses: its own, else the assistant's. */
export function wizardConnection(role: WizardRole): LlmConnection | null {
  const { connections, assistConnectionId } = useLlmStore.getState();
  const w = useLoreWizardStore.getState();
  const own = role === 'planner' ? w.plannerConnectionId : w.writerConnectionId;
  return connections.find((c) => c.id === own) ?? connections.find((c) => c.id === assistConnectionId) ?? connections[0] ?? null;
}

export function wizardCall(role: WizardRole, label: string, messages: LlmMessage[], opts: LlmCallOptions = {}): Promise<LlmCallResult> {
  return llmCall(wizardConnection(role), `🧙 Lorebook wizard: ${label}`, messages, opts);
}
