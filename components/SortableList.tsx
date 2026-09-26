'use client';

import type { ReactNode } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// Drag-to-reorder for greetings and lorebook entries. Items are addressed
// by index (greetings are bare strings); callers get the move as
// (from, to) and apply it to their own array.

export { arrayMove };

export function SortableList({ count, onMove, children }: { count: number; onMove: (from: number, to: number) => void; children: (index: number, handle: ReactNode) => ReactNode }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const ids = Array.from({ length: count }, (_, i) => `item-${i}`);
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    onMove(ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2">
          {ids.map((id, i) => (
            <SortableRow key={id} id={id}>
              {(handle) => children(i, handle)}
            </SortableRow>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({ id, children }: { id: string; children: (handle: ReactNode) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      title="Drag to reorder"
      aria-label="Drag to reorder"
      className="flex h-7 w-5 cursor-grab items-center justify-center text-slate-500 hover:text-slate-300 active:cursor-grabbing"
    >
      ⠿
    </button>
  );
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition, zIndex: isDragging ? 10 : undefined, position: 'relative', opacity: isDragging ? 0.85 : 1 }}>
      {children(handle)}
    </div>
  );
}

/** Where a remembered set of open/folded indices goes after a move. */
export function remapIndex(i: number, from: number, to: number): number {
  if (i === from) return to;
  if (from < to && i > from && i <= to) return i - 1;
  if (from > to && i < from && i >= to) return i + 1;
  return i;
}
