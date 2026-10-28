import { useDeferredValue, useMemo } from 'react';
import { hasBlockingIssues, validateDocument } from '@buildview/geometry-engine';
import type { ValidationIssue } from '@buildview/shared';
import { useEditor } from './editorStore.ts';

export interface ValidationSummary {
  issues: ValidationIssue[];
  critical: number;
  warning: number;
  info: number;
  blocking: boolean;
  /** element id -> worst open severity */
  byElement: Map<string, 'critical' | 'warning' | 'info'>;
}

/** Validation of the live document. Deferred so dragging stays smooth; recomputed per committed change. */
export function useValidation(): ValidationSummary {
  const doc = useEditor((s) => s.history.present);
  const deferred = useDeferredValue(doc);
  return useMemo(() => {
    const issues = validateDocument(deferred);
    const open = issues.filter((i) => i.status === 'open');
    const byElement = new Map<string, 'critical' | 'warning' | 'info'>();
    const rank = { critical: 0, warning: 1, info: 2 } as const;
    for (const i of open) for (const id of i.elementIds) {
      const prev = byElement.get(id);
      if (!prev || rank[i.severity] < rank[prev]) byElement.set(id, i.severity);
    }
    return {
      issues,
      critical: open.filter((i) => i.severity === 'critical').length,
      warning: open.filter((i) => i.severity === 'warning').length,
      info: open.filter((i) => i.severity === 'info').length,
      blocking: hasBlockingIssues(issues),
      byElement,
    };
  }, [deferred]);
}
