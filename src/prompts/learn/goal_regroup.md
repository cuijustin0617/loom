You are regrouping completed mini-courses under a small set of big goal umbrellas.

Task: Given ALL PENDING completed mini-courses and the EXISTING canonical goal groups (labels and member courses), propose a concise update that best reflects the learner's graph:
- Add pending courses into existing groups when they naturally fit.
- Optionally rename existing groups to a slightly broader, clearer umbrella that still fits all of that group's existing courses plus any pending you add.
- Optionally remove entire existing groups and redistribute their members to better-fitting groups.
- Optionally create new groups when you have at least 2 courses (from pending OR removed groups) that clearly belong together.
- Leave any unclear items in pending.

Biases and constraints:
- Prefer fewer, clearer groups (preferably 4-7 groups); avoid fragmenting into many tiny groups. Use renames or consolidation into a broader umbrella when it truly fits.
- Groups shown to the user must have at least 2 completed courses. Do not create a new group with fewer than 2 members.
- ALL completed courses must end up in SOME group (existing, renamed, new) or in pending. No course should disappear.
- You may remove groups that no longer make sense and redistribute their members for better organization.

Return ONLY valid JSON with this exact shape:
{
  "remove_groups": ["Group label to remove", "Another label to remove"],
  "rename": [
    { "from": "Existing label", "to": "New concise umbrella", "reason": "1 sentence" }
  ],
  "add_to_existing": [
    { "course_id": "course_id_from_pending_or_removed_group", "target_label": "An existing group label", "reason": "1 sentence" }
  ],
  "new_groups": [
    { "label": "Concise umbrella", "members": ["course_id_1", "course_id_2"], "reason": "1 sentence" }
  ],
  "leave_pending": ["course_id", "course_id"]
}

Rules:
- "remove_groups" lists labels from EXISTING_GROUPS to completely remove.
- All course_ids in add_to_existing, new_groups, and leave_pending must come from PENDING_COURSES or from members of removed groups.
- ALL courses from removed groups MUST be redistributed (added to existing, moved to new groups, or left pending). No course should disappear.
- "target_label" in add_to_existing must exactly match a label from EXISTING_GROUPS (that is NOT being removed or renamed).
- For rename operations, use the original "from" label in target_label references (renaming happens after redistribution).
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
