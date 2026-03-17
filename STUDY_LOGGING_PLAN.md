# User Study Logging Plan

**Status: IMPLEMENTED** — All ✅ items below are now logged. Event names are the exact strings stored in the database.

---

## Session & Auth

| # | Action | Event Name | Data Fields |
|---|--------|-----------|-------------|
| 1 | User logs in | ✅ `session_start` | `isNew` |
| 2 | User logs out | ✅ `session_end` | — |
| 3 | Session ends (tab close / beforeunload) | ✅ `session_end` | — |

---

## Chat & Messaging

| # | Action | Event Name | Data Fields |
|---|--------|-----------|-------------|
| 5 | User sends a message | ✅ `query_sent` | `chatId`, `topicId`, `hasContext` |
| 6 | User creates a new chat | ✅ `chat_created` | `chatId` |
| 7 | User clicks an existing chat — **Recent view** | ✅ `chat_selected` | `chatId`, `topicId`, `view: "recent"` |
| 7 | User clicks an existing chat — **Topics view** | ✅ `chat_selected` | `chatId`, `topicId`, `view: "topics"` |
| 8 | User deletes a chat | ✅ `chat_deleted` | `chatId`, `topicId` |
| 15 | User switches chat list view (Recent ↔ By Topic) | ✅ `view_switched` | `view` |

---

## Chunk Labels (within chat)

| # | Action | Event Name | Data Fields |
|---|--------|-----------|-------------|
| 16 | User labels chunk as "understood" | ✅ `chunk_labeled` | `chatId`, `msgId`, `chunkIdx`, `label: "understood"` |
| 17 | User labels chunk as "unsure" | ✅ `chunk_labeled` | `chatId`, `msgId`, `chunkIdx`, `label: "unsure"` |
| 18 | User removes a chunk label | ✅ `chunk_labeled` | `chatId`, `msgId`, `chunkIdx`, `label: "removed"` |

---

## Topic Management — Suggestions

| # | Action | Event Name | Data Fields |
|---|--------|-----------|-------------|
| 19 | User accepts a topic suggestion | ✅ `topic_suggestion_accepted` | `topicId` |
| 20 | User dismisses a topic suggestion | ✅ `topic_suggestion_dismissed` | `topicId` |
| 21 | Auto topic detection triggered | ✅ `topic_auto_detect_triggered` | `candidateCount` |

---

## Topic Management — CRUD

| # | Action | Event Name | Data Fields |
|---|--------|-----------|-------------|
| 22 | User creates a new topic | ✅ `topic_created` | `topicId`, `topicName`, `isAutoDetected` |
| 24 | User renames a topic | ✅ `topic_renamed` | `topicId`, `oldName`, `newName` |
| 25 | Topic assigned to a chat — **manually** | ✅ `topic_assigned` | `chatId`, `topicId`, `assignMethod: "manual"` |
| 25 | Topic assigned to a chat — **auto-detected** | ✅ `topic_assigned` | `chatId`, `topicId`, `assignMethod: "auto"`, `isOneOff?` |

---

## Topic Management — Picker

| # | Action | Event Name | Data Fields |
|---|--------|-----------|-------------|
| 26 | User opens the topic picker dropdown | ✅ `topic_picker_opened` | — |
| 27 | User selects a topic from the picker | ✅ `topic_picker_selected` | `topicId`, `topicName` |
| 29 | User selects via keyboard (Enter) | ✅ `topic_picker_keyboard_select` | `key: "Enter"`, `index` |

---

## Topic Management — Merge

| # | Action | Event Name | Data Fields |
|---|--------|-----------|-------------|
| 30 | User drags a topic onto another | ✅ `topic_merge_drag` | `sourceTopicId`, `targetTopicId` |
| 31 | User clicks the merge button (opens dialog) | ✅ `topic_merge_dialog_opened` | `topicId`, `topicName` |
| 32 | User confirms merge in dialog | ✅ `topic_merge_confirmed` | `sourceTopicId`, `targetTopicId` |
| 33 | User cancels merge dialog | ✅ `topic_merge_cancelled` | `sourceTopicId` |

---

## Topic Management — Move / Unassign

| # | Action | Event Name | Data Fields |
|---|--------|-----------|-------------|
| 35 | User confirms move-chat in dialog | ✅ `chat_moved` | `chatId`, `oldTopicId`, `newTopicId` |
| 37 | User unassigns a chat from its topic | ✅ `chat_unassigned` | `chatId`, `topicId` |

---

## Module 1: Overview / Trajectories — Viewing

| # | Action | Event Name | Data Fields |
|---|--------|-----------|-------------|
| 38 | Module 1 sidebar shown (topic selected) | ✅ `module1_viewed` | `topicId` |
| 39 | User collapses/expands the Overview section | ✅ `overview_section_toggled` | `section`, `collapsed` |
| 40 | User collapses/expands a thread (toggle steps) | ✅ `thread_toggled` | `topicId`, `threadIdx`, `expanded` |
| 41 | User collapses/expands Module 1 section | ✅ `module_collapsed` | `moduleId: "moduleStatus"`, `collapsed` |

---

## Module 1: Overview / Trajectories — Manual Edits

| # | Action | Event Name | Data Fields |
|---|--------|-----------|-------------|
| 42 | User deletes an overview point | ✅ `summary_edited` | `topicId`, `section`, `editType: "delete"`, `oldValue` |
| 43 | User deletes a thread | ✅ `summary_edited` | `topicId`, `section: "threads"`, `editType: "delete_thread"`, `oldValue` |
| 44 | User deletes a thread step | ✅ `summary_edited` | `topicId`, `section: "threads"`, `editType: "delete_step"`, `oldValue` |
| 45 | User inline-edits an overview item | ✅ `summary_edited` | `topicId`, `section`, `editType: "edit"`, `oldValue`, `newValue` |
| 46 | User inline-edits a thread step | ✅ `summary_edited` | `topicId`, `section: "threads"`, `editType: "edit_step"`, `oldValue`, `newValue` |

---

## Module 1: Overview / Trajectories — AI Edit

| # | Action | Event Name | Data Fields |
|---|--------|-----------|-------------|
| 47 | User clicks AI edit button | ✅ `summary_ai_edited` | `topicId` |
| 48 | User submits AI edit instruction | ✅ `summary_ai_edited` | `topicId`, `instruction` |

---

## Module 1: Overview / Trajectories — Update

| # | Action | Event Name | Data Fields |
|---|--------|-----------|-------------|
| 50 | User manually triggers status update | ✅ `summary_updated` | `topicId`, `trigger: "manual"` |

---

## Module 2: Connections — Display

| # | Action | Event Name | Data Fields |
|---|--------|-----------|-------------|
| 53 | Connection card rendered in sidebar | ✅ `module2_connection_shown` | `chatId`, `connectionChatId` |
| 55 | User hovers a connection marker `{~N}` in chat | ✅ `connection_marker_hovered` | `connId`, `chatId` |
| 57 | User clicks a connection card in sidebar | ✅ `connection_sidebar_card_clicked` | `connId`, `chatId`, `connectionChatId` |
| 58 | User collapses/expands Module 2 section | ✅ `module_collapsed` | `moduleId: "moduleConnections"`, `collapsed` |

---

## Module 2: Connections — Actions

| # | Action | Event Name | Data Fields |
|---|--------|-----------|-------------|
| 59 | User clicks "Go to chat" on connection card | ✅ `module2_connection_clicked` | `chatId`, `connectionChatId`, `action: "view"` |
| 60 | User clicks "Build on this" on connection card | ✅ `module2_connection_clicked` | `chatId`, `connectionChatId`, `action: "build"` |
| 61 | User closes a connection card | ✅ `connection_card_closed` | `chatId` |

---

## Module 2: Additional Marker Interaction

| # | Action | Event Name | Data Fields |
|---|--------|-----------|-------------|
| — | User clicks a connection marker `{~N}` in chat | ✅ `connection_marker_clicked` | `connId`, `chatId` |

---

## Module 3: Suggestions / Directions — Sidebar

| # | Action | Event Name | Data Fields |
|---|--------|-----------|-------------|
| 62 | User clicks a direction card (sets context) | ✅ `module3_direction_clicked` | `topicId`, `directionTitle` |
| 63 | User drags a direction card to chat input | ✅ `module3_direction_dragged` | `topicId`, `directionTitle` |
| 64 | User clicks "New chat" on a direction card | ✅ `module3_direction_new_chat` | `topicId`, `directionTitle` |
| 65 | User clicks shuffle button (sidebar) | ✅ `module3_shuffled` | `topicId`, `location: "sidebar"`, `oldDirections`, `newDirections` |
| 66 | User collapses/expands Module 3 section | ✅ `module_collapsed` | `moduleId: "moduleDirections"`, `collapsed` |

---

## Module 3: Suggestions / Directions — Welcome Page

| # | Action | Event Name | Data Fields |
|---|--------|-----------|-------------|
| 67 | User clicks a suggestion card on welcome page | ✅ `welcome_suggestion_clicked` | `topicId`, `topicName`, `question` |
| 68 | User clicks shuffle on welcome page | ✅ `module3_shuffled` | `location: "welcome"`, `topicId: null` |

---

## Context Block

| # | Action | Event Name | Data Fields |
|---|--------|-----------|-------------|
| 69 | Context block added | ✅ `context_block_added` | `chatId`, `sourceType`, `label` |
| 70 | User closes context block | ✅ `context_block_closed` | `chatId` |
| 71 | User expands/collapses context block | ✅ `context_block_toggled` | `expanded` |

---

## UI & Layout

| # | Action | Event Name | Data Fields |
|---|--------|-----------|-------------|
| 74 | User collapses left sidebar | ✅ `sidebar_collapsed` | `side: "left"`, `collapsed` |
| 75 | User collapses right sidebar | ✅ `sidebar_collapsed` | `side: "right"`, `collapsed` |
| 76 | User clicks a context tag in chat message | ✅ `context_tag_clicked` | `type`, `label` |

---

## Baseline Condition

| # | Action | Event Name | Data Fields |
|---|--------|-----------|-------------|
| 77 | Baseline personal details extracted | ✅ `baseline_details_shown` | `count` |

---

## Complete Event Reference

| Event Name | Module | Where Fired |
|-----------|--------|-------------|
| `session_start` | Auth | app.js |
| `session_end` | Auth | app.js |
| `chat_created` | Chat | app.js |
| `chat_deleted` | Chat | app.js |
| `chat_selected` | Chat | app.js — `view: "recent"` or `"topics"` |
| `chat_moved` | Chat | app.js |
| `chat_unassigned` | Chat | app.js |
| `query_sent` | Chat | app.js |
| `view_switched` | UI | app.js |
| `sidebar_collapsed` | UI | app.js |
| `context_tag_clicked` | UI | app.js |
| `chunk_labeled` | Module 1 | app.js |
| `topic_suggestion_accepted` | Topics | app.js |
| `topic_suggestion_dismissed` | Topics | app.js |
| `topic_created` | Topics | app.js |
| `topic_renamed` | Topics | app.js |
| `topic_assigned` | Topics | app.js — `assignMethod: "manual"` or `"auto"` |
| `topic_auto_detect_triggered` | Topics | app.js |
| `topic_picker_opened` | Topics | app.js |
| `topic_picker_selected` | Topics | app.js |
| `topic_picker_keyboard_select` | Topics | app.js |
| `topic_merge_drag` | Topics | app.js |
| `topic_merge_dialog_opened` | Topics | app.js |
| `topic_merge_confirmed` | Topics | sidebar.js |
| `topic_merge_cancelled` | Topics | sidebar.js |
| `module1_viewed` | Module 1 | sidebar.js |
| `summary_edited` | Module 1 | sidebar.js |
| `summary_ai_edited` | Module 1 | sidebar.js |
| `summary_updated` | Module 1 | sidebar.js |
| `overview_section_toggled` | Module 1 | sidebar.js |
| `thread_toggled` | Module 1 | sidebar.js |
| `module_collapsed` | All modules | sidebar.js — `moduleId`: `moduleStatus`, `moduleConnections`, or `moduleDirections` |
| `module2_connection_shown` | Module 2 | sidebar.js |
| `module2_connection_clicked` | Module 2 | app.js — `action: "view"` or `"build"` |
| `connection_marker_hovered` | Module 2 | app.js |
| `connection_marker_clicked` | Module 2 | app.js |
| `connection_sidebar_card_clicked` | Module 2 | sidebar.js |
| `connection_card_closed` | Module 2 | app.js |
| `module3_direction_clicked` | Module 3 | sidebar.js |
| `module3_direction_dragged` | Module 3 | sidebar.js |
| `module3_direction_new_chat` | Module 3 | sidebar.js |
| `module3_shuffled` | Module 3 | sidebar.js / app.js |
| `welcome_suggestion_clicked` | Module 3 | app.js |
| `context_block_added` | Context | app.js |
| `context_block_closed` | Context | app.js |
| `context_block_toggled` | Context | app.js |
| `baseline_details_shown` | Baseline | app.js |

**Total: 47 distinct event types** logged across all interactions.

---

## Safety & Durability

| Mechanism | Description |
|-----------|-------------|
| **Primary delivery** | `POST /api/log` fire-and-forget on every event |
| **Local backup queue** | Failed events stored in `localStorage["loom_event_queue"]` |
| **Retry** | Failed events retried up to 3 times with 5 s delay |
| **Page-close persistence** | Queue flushed to localStorage on `beforeunload` |
| **Auto JSON backup** | Server writes `backend/data/backups/events_backup_*.json` every 50 events |
| **Manual backup trigger** | `GET /api/admin/backup` creates an immediate snapshot |
| **SQLite WAL mode** | Database uses WAL journal for crash safety |
| **Last 10 backups kept** | Older backup files pruned automatically |

---

## Admin Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/admin/events` | All raw events (optionally `?userId=…`) |
| `GET /api/admin/events/summary` | Counts grouped by user + event type |
| `GET /api/admin/export` | Download all events as `loom_events_YYYYMMDD.json` |
| `GET /api/admin/backup` | Trigger immediate JSON backup |
| `GET /api/admin/users` | List all users who have logged events |
