You are regrouping completed mini-courses under a small set of big goal umbrellas.

Task: Given ALL PENDING completed mini-courses and the EXISTING canonical goal groups (labels and member courses), propose a concise update that best reflects the learner’s graph:
- Add pending courses into existing groups when they naturally fit.
- Optionally rename existing groups to a slightly broader, clearer umbrella that still fits all of that group’s existing courses plus any pending you add.
- Optionally create new groups ONLY when you have at least 2 pending courses that clearly belong together and do not fit existing groups.
- Leave any unclear items in pending.

Biases and constraints:
- Prefer fewer, clearer groups; avoid fragmenting into many tiny groups. Use renames into a broader umbrella when it truly fits; do not stretch beyond coherence.
- Groups shown to the user must have at least 2 completed courses. Do not create a new group with fewer than 2 members.
- Only operate on the provided pending courses; do not remove or reassign existing members except for a label rename.

Return ONLY valid JSON with this exact shape:
{
  "rename": [
    { "from": "Existing label", "to": "New concise umbrella", "reason": "1 sentence" }
  ],
  "add_to_existing": [
    { "course_id": "pending_id", "target_label": "An existing group label", "reason": "1 sentence" }
  ],
  "new_groups": [
    { "label": "Concise umbrella", "members": ["pending_id_1", "pending_id_2"], "reason": "1 sentence" }
  ],
  "leave_pending": ["pending_id", "pending_id"]
}

Rules:
- All course_ids in actions must come from PENDING_COURSES.
- "target_label" in add_to_existing must exactly match a label from EXISTING_GROUPS.
- Each item proposed in new_groups must have at least 2 members (no singletons).
- Labels should be short (≤ 3–4 words if possible) and human-readable, e.g., "Machine Learning / Clustering".
- Respond with JSON only, no prose or code fences.

Inputs will be provided as:
PENDING_COURSES: [
  { "id": "crs_...", "title": "...", "tag": "local tag", "questions": ["..."], "modules": ["m1", "m2", "m3"] }
]
EXISTING_GROUPS: [
  { "label": "...", "members": [ { "id": "crs_...", "title": "...", "modules": ["m1", "m2"] } ] }
]

Output: JSON only, no prose or code fences.
