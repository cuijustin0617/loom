# 🧵 Loom - AI Chat Interface

A modern, clean ChatGPT-like interface built with React and Tailwind CSS. Features conversation management, multiple AI model support, and a responsive design.

## Features

- **Clean, modern UI** with white background and blue accents
- **Multiple AI Models**: Gemini 2.5 Flash, Gemini 2.5 Pro, and GPT-4o Mini
- **Conversation Management**: 
  - Persistent conversation history (localStorage)
  - Auto-generated conversation titles after 2 user messages
  - Auto-generated conversation summaries on switch/close/inactivity
- **Smart Features**:
  - Model selection (no mid-conversation switching)
  - Auto-scroll in chat
  - Error handling with inline display
  - Responsive design
- **Future-ready**: Built with modular architecture for upcoming "Explore/Learn Mode"

## Setup

1. **Clone and Install**:
   ```bash
   npm install
   ```

2. **Environment Variables**:
   Create a `.env` file in the project root:
   ```bash
   VITE_OPENAI_API_KEY=your_openai_api_key_here
   VITE_GEMINI_API_KEY=your_google_gemini_api_key_here
   ```

3. **API Keys**:
   - **OpenAI API**: Get your key from [OpenAI Platform](https://platform.openai.com/api-keys)
   - **Google Gemini API**: Get your key from [Google AI Studio](https://makersuite.google.com/app/apikey)

4. **Run**:
   ```bash
   npm run dev
   ```

## Usage

- **New Chat**: Click the "New Chat" button in the sidebar
- **Switch Models**: Use the dropdown in the chat header (starts new conversation)
- **Conversation History**: Click any conversation in the sidebar to continue
- **Auto-features**: 
  - Titles generated after your 2nd message
  - Summaries created when switching conversations or after 5 minutes of inactivity

## Architecture

```
src/
├── components/     # React components (Logo, Sidebar, Chat, etc.)
├── services/       # API integrations (OpenAI, Gemini)
├── hooks/          # Custom hooks (useConversations)
├── utils/          # Utilities (localStorage management)
└── App.jsx         # Main application
```

Built with ❤️ for clean, efficient AI conversations.