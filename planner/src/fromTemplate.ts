// A new plan from one of the Planner's ready-made templates: its cues, the
// day's schedule and (with the show-day update) its crew, tasks and gear.

import { createPlan, saveBlocks, saveCues, updatePlan, type Db } from './api';
import { saveItems } from './apiPro';
import { blankBlock } from './blocks';
import { blankItem } from './items';
import { STEP, blankCue } from './model';
import { templateParts, type Template } from './templates';
import { newId } from './useItems';

export async function planFromTemplate(db: Db, t: Template, name: string, date: string, userId: string): Promise<string> {
  const plan = await createPlan(db, name || t.name, userId, date);
  await updatePlan(db, plan.id, { startTime: t.startTime });
  const parts = templateParts(t, date);
  await saveCues(
    db,
    parts.cues.map((c, i) => ({ ...blankCue(plan.id, newId(), (i + 1) * STEP), ...c })),
    plan.pro,
  );
  await saveBlocks(
    db,
    parts.blocks.map((b, i) => ({ ...blankBlock(plan.id, newId(), date, (i + 1) * 1024), ...b, day: date })),
  );
  if (plan.pro) {
    try {
      await saveItems(
        db,
        parts.items.map((it, i) => ({ ...blankItem(plan.id, newId(), it.kind, (i + 1) * 1024), ...it })),
      );
    } catch {
      // The lists are a bonus: the plan is made either way.
    }
  }
  return plan.id;
}
