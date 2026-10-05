/** Pure classification of where a mission really is. Nothing here launches work, calls JEV or grants permission.
 * Every non-terminal mission of an autonomous project lands in exactly one state:
 *   running | queued_admissible | waiting_host | gated_human | stalled | idle_unmanaged
 * `stalled` means: nothing moved it for longer than the SLA although it is not waiting on a person. */
export const STALL_SLA_MS=1800000,DISPATCH_GRACE_MS=120000;
const HOST='host-scheduler',HUMAN='human';
const ms=value=>{const parsed=Date.parse(value??'');return Number.isFinite(parsed)?parsed:null;};
const newest=(...values)=>{const known=values.map(ms).filter(Number.isFinite);return known.length?Math.max(...known):null;};
// Waits that resolve by themselves and so never count as a stall, however long the line is.
const SELF_RESOLVING=new Set(['waiting_capacity','waiting_dependency','decision_in_progress','pending_triage','wip_wait','breaker_open']);

export function classifyMission(task,{now=Date.now(),slaMs=STALL_SLA_MS,recovery=null,dispatchStuck=new Set()}={}){
  if(!task||task.archived_at||task.opportunity_audit||task.direction_assist||task.status==='done')return null;
  const base=newest(task.progress?.last_activity_at,task.queue?.enqueued_at,task.started_at,task.ended_at,task.autonomy_history?.at(-1)?.ended_at,task.watch?.last_progress_at,task.created_at);
  const quiet=base===null?0:Math.max(0,now-base);
  const make=(state,reason,owner,extra={})=>({task_id:task.id,state,reason,owner,since:base===null?null:new Date(base).toISOString(),quiet_ms:quiet,...extra});
  if(task.external_work?.status==='active'||task.desktop_review?.status==='active'&&ms(task.desktop_review.expires_at)>now)return make('running','session_active','session');
  if(task.queue?.status==='queued'){
    const wait=task.queue_wait;
    if(wait?.code==='capacity_held_by_unconfirmed'){
      const held=Number.isFinite(wait.blocking_since_ms)?now-wait.blocking_since_ms:0;
      return held>slaMs?make('stalled','capacity_held_by_unconfirmed',HUMAN):make('waiting_host','capacity_held_by_unconfirmed',HOST);
    }
    if(dispatchStuck.has(task.id))return make('stalled','dispatch_stuck',HOST);
    if(wait?.code==='waiting_dependency')return make('waiting_host','waiting_dependency',HOST);
    return make('queued_admissible',wait?.code??'queued',HOST);
  }
  if(task.queue?.status==='selecting')return make('running','dispatching',HOST);
  if(['planning','running','reviewing'].includes(task.status))return quiet>slaMs?make('stalled','executor_silent',HOST):make('running','executing',HOST);
  if(!['backlog','review','blocked'].includes(task.status))return null;
  if(!recovery)return make('idle_unmanaged','not_autonomous',HUMAN);
  if(recovery.status==='gate')return make('gated_human',recovery.reason,HUMAN);
  if(recovery.status==='diagnosing')return make('running',recovery.reason,HOST);
  const retry=Number.isFinite(recovery.retry_at_ms)?recovery.retry_at_ms:null;
  if(retry!==null&&retry>now)return make('waiting_host',recovery.reason,HOST,{retry_at_ms:retry});
  if(SELF_RESOLVING.has(recovery.reason))return make('waiting_host',recovery.reason,HOST);
  return quiet>slaMs?make('stalled',recovery.reason,HOST,{retry_at_ms:retry}):make('waiting_host',recovery.reason,HOST);
}

/** Aggregates classifications into the flow health. `capacity` is supplied by the host (limits, live and phantom slots). */
export function healthReport(classes,{capacity=null,noopSuppressed=0}={}){
  const rows=classes.filter(Boolean),count=state=>rows.filter(row=>row.state===state).length;
  const stalled=rows.filter(row=>row.state==='stalled').map(({task_id,reason,owner,since,quiet_ms})=>({task_id,reason,owner,since,quiet_ms}));
  const progressing=count('running')+count('queued_admissible'),waiting=count('waiting_host'),gated=count('gated_human');
  const state=!rows.length?'empty':stalled.length?'stalled':progressing||waiting?'progressing':gated?'gated':'idle';
  return {state,counts:{running:count('running'),queued_admissible:count('queued_admissible'),waiting_host:waiting,gated_human:gated,stalled:stalled.length,idle_unmanaged:count('idle_unmanaged')},stalled,capacity,noop_suppressed:noopSuppressed};
}
