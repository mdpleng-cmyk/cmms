// assetDetailHelpers.js
// Two things that need no new columns at all:
//  1. A "status" for the asset, derived from its open work orders.
//  2. "Watch items" for the Overview banner, pulled from the notes left
//     on the most recent inspection's checklist results.

import { sb, formatDate, toast } from './store.js';

/**
 * Status is derived, not stored — it always reflects the current
 * work_orders state instead of a field that could go stale.
 *   - any open/in_progress breakdown WO  -> "Down"
 *   - else any open/in_progress pm WO    -> "Under maintenance"
 *   - else                               -> "Running"
 */
export async function getAssetStatus(assetId) {
  const { data, error } = await sb
    .from('work_orders')
    .select('type,status')
    .eq('asset_id', assetId)
    .in('status', ['open', 'in_progress']);
  if (error) {
    toast('Could not load asset status', 'err');
    throw error;
  }

  const hasBreakdown = data.some(wo => wo.type === 'breakdown');
  const hasPM = data.some(wo => wo.type === 'pm');

  if (hasBreakdown) return { label: 'Down', tone: 'red' };
  if (hasPM) return { label: 'Under maintenance', tone: 'amber' };
  return { label: 'Running', tone: 'green' };
}

/**
 * Watch items = any checklist result with a non-null note on the most
 * recently *closed* work order for a given recurring schedule (e.g. the
 * asset's weekly inspection schedule). No new "flag" column needed —
 * a technician leaving a note on a checklist item IS the flag.
 *
 * If you later want to distinguish "just a comment" from "needs a
 * follow-up," add one small enum column to wo_checklist_results
 * (e.g. flag: ok | watch | fail) — optional, not required to ship this.
 */
export async function getLatestWatchItems(assetId, scheduleId) {
  const { data: latestWO, error: woErr } = await sb
    .from('work_orders')
    .select('id, closed_at')
    .eq('asset_id', assetId)
    .eq('schedule_id', scheduleId)
    .eq('status', 'closed')
    .order('closed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (woErr) {
    toast('Could not load inspection history', 'err');
    throw woErr;
  }
  if (!latestWO) return [];

  const { data: results, error } = await sb
    .from('wo_checklist_results')
    .select('note, checklist_items(description)')
    .eq('wo_id', latestWO.id)
    .not('note', 'is', null);
  if (error) {
    toast('Could not load checklist notes', 'err');
    throw error;
  }

  return results.map(r => ({
    description: r.checklist_items?.description ?? '',
    note: r.note,
    date: formatDate(latestWO.closed_at),
  }));
}

/**
 * Convenience: run this for every recurring_schedule an asset has (e.g.
 * one for "weekly inspection", one for "500-hour PM") and flatten the
 * results into a single list for the Overview banner.
 */
export async function getAllWatchItemsForAsset(assetId, scheduleIds) {
  const lists = await Promise.all(
    scheduleIds.map(id => getLatestWatchItems(assetId, id))
  );
  return lists.flat();
}
