export async function logActivity(client, { actorId, action, entity, entityId, detail }) {
  await client.query(
    `INSERT INTO activity_log (actor_id, action, entity, entity_id, detail)
     VALUES ($1, $2, $3, $4, $5)`,
    [actorId, action, entity, entityId ?? null, detail ?? null],
  );
}
