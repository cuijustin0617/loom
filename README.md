# Loom – Knowledge Sidebar

An AI chat interface with a right-side knowledge sidebar that externalizes the AI's memory into a visible, structured, and editable user model organized by topic. As you chat, Loom detects recurring topics, links related past conversations, and suggests unexplored directions — making personalization transparent and controllable.

## Quick Start

```bash
# 1. Create a virtual environment (Python 3.10+)
python3 -m venv venv
source venv/bin/activate   # macOS/Linux
# venv\Scripts\activate    # Windows

# 2. Install dependencies
pip install -r backend/requirements.txt

# 3. Configure API keys
cp backend/.env.example backend/.env
# Edit backend/.env with your keys

# 4. Run the server
cd backend
uvicorn main:app --reload --port 8000
```

Open http://localhost:8000

## API Keys

Set in `backend/.env`:

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | OpenAI models + embeddings |
| `GEMINI_API_KEY` | Google Gemini models + embeddings |
| `LLM_PROVIDER` | `openai` or `gemini` |
| `EMBEDDING_PROVIDER` | `openai` or `gemini` |

## Tests

```bash
python -m pytest tests/ -v
```

## Project Structure

```
loom/
├── backend/        Python FastAPI (stateless, all data on frontend)
│   ├── main.py         API endpoints
│   ├── llm_router.py   Multi-provider LLM client
│   ├── embeddings.py   Embedding + similarity ranking
│   └── prompts.py      All prompt templates
├── frontend/       Vanilla HTML/CSS/JS with localStorage
│   ├── index.html      Main layout (3-column)
│   ├── app.js          Chat controller
│   ├── sidebar.js      Right sidebar modules
│   ├── storage.js      localStorage persistence
│   └── utils.js        Markdown, helpers
├── tests/          Pytest suite
└── README.md
```

## Architecture

- **Backend**: Python FastAPI – stateless; all persistence lives in the browser's `localStorage`
- **Frontend**: Vanilla HTML/CSS/JS – no build step
- **LLM**: OpenAI GPT or Google Gemini (selectable per-chat in the UI)
- **Embeddings**: OpenAI `text-embedding-3-small` or Gemini `text-embedding-004`
- **Ranking**: Cosine similarity on embeddings for relevance scoring

## Sidebar Modules

The right sidebar activates when Loom detects a recurring topic and provides three modules:

1. **Status Summary** – Structured, editable representation of what the AI has inferred about you in this topic (overview + specifics with understanding levels)
2. **Linked Past Chats** – Relevant past conversations with bridge questions explaining how they connect to your current chat
3. **Explore Next** – Suggested adjacent topics you haven't explored yet, phrased as questions you could ask

All sidebar cards are draggable into the chat input to use as context.
