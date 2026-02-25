# Loom – Knowledge Sidebar

An AI chat interface with an intelligent right sidebar that detects recurring topics, surfaces relevant past conversations, and generates personalized drag-and-drop prompt modules to help users build durable knowledge from ephemeral chats.

## Quick Start

```bash
# 1. Install Python dependencies
pip install -r backend/requirements.txt

# 2. Configure API keys
cp backend/.env.example backend/.env
# Edit backend/.env with your keys

# 3. Run the server
cd backend
uvicorn main:app --reload --port 8000
```

Open http://localhost:8000

## API Keys

Set in `backend/.env`:

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | GPT-4o + embeddings |
| `GEMINI_API_KEY` | Gemini Flash (alternative) |
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
├── frontend/       Vanilla HTML/CSS/JS with localStorage
├── tests/          Pytest suite (220 tests)
├── prototypes/     Static HTML demo pages
├── docs/           Research paper, screenshots, planning
├── legacy/         Old React/Vite codebase (archived)
├── cursor.md       Cursor IDE rules
└── README.md
```

## Architecture

- **Backend**: Python FastAPI – stateless, all persistence on the frontend
- **Frontend**: Vanilla HTML/CSS/JS with `localStorage`
- **LLM**: OpenAI GPT-4o or Google Gemini (configurable via env)
- **Embeddings**: `text-embedding-3-small` or Gemini `text-embedding-004`
- **Ranking**: Cosine similarity on embeddings for fast relevance scoring
