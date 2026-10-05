// Builds the per-criterion checks a conforming reviewer would return for the confirmed criteria set carried by a review snapshot.
export const coverage=(snapshot,status='passed',evidence=['fixture evidence'])=>({
 criteria_hash:snapshot.criteria.hash,
 checks:snapshot.criteria.items.map(item=>({criterion_id:item.id,criterion:item.text,status,evidence})),
});
