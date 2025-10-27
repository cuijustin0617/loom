# LOOM - AI Learning Assistant

An intelligent chat interface with integrated learning features powered by Google Gemini and OpenAI.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## ✨ Features

### Chat Mode
- 💬 Multi-model AI chat (Gemini 2.5 Pro/Flash, GPT-4o-mini)
- 🔄 Real-time streaming responses
- 📎 Image and PDF attachments
- 🔍 Google Search integration
- 📝 Auto-generated conversation summaries
- 💾 Persistent chat history

### Learn Mode
- 📚 AI-generated course outlines from chat history
- 🎯 Personalized learning paths
- 📊 Progress tracking
- 🔖 Save and organize courses
- ✅ Knowledge validation

## 🏗️ Architecture

### Tech Stack
- **Frontend**: React 18 + Vite
- **State Management**: Zustand + Immer
- **Database**: Dexie.js (IndexedDB wrapper)
- **Async Operations**: TanStack Query (React Query)
- **Styling**: Tailwind CSS
- **AI APIs**: Google Gemini, OpenAI
- **Auth**: Firebase (optional)

### Folder Structure
```
src/
├── features/          # Feature modules (Chat, Learn)
│   ├── chat/         # Chat feature
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── services/
│   │   └── store/
│   └── learn/        # Learn feature
│       ├── components/
│       ├── hooks/
│       ├── services/
│       └── store/
├── shared/           # Shared components, utilities
│   ├── components/
│   ├── store/
│   └── utils/
├── lib/              # Core libraries
│   ├── ai/          # AI service integrations
│   ├── db/          # Database & migration
│   └── queryClient.js
├── prompts/          # LLM prompts
└── services/         # Firebase & legacy services
```

## 🗄️ Data Storage

### IndexedDB (via Dexie)
Primary storage with 50MB+ quota:
- Conversations and messages
- Course data and progress
- User settings
- Sync metadata

### Auto-Migration
First-time users with localStorage data are automatically migrated to IndexedDB.

## 🔑 Configuration

### Required: Gemini API Key
1. Get a free API key: https://ai.google.dev/
2. Open Settings in the app
3. Paste your API key

### Optional: OpenAI API Key
For GPT-4o-mini model support.

### Optional: Firebase
For cloud sync and authentication.

## 🎨 Key Design Decisions

### Normalized State
Each entity (conversation, message, course) is stored once with relationships via IDs.

### Limited Retries
- Queries: 1 retry
- Mutations: 0 retries
- Philosophy: Don't hide errors, surface them quickly

### Auto-Summaries
Conversations get summaries automatically:
- After first exchange
- Every 3 new messages
- Displayed in sidebar

### Feature-Based Organization
Chat and Learn are separate, self-contained features with clear boundaries.

## 📊 Performance

- Bundle size: ~2MB total (~522KB gzipped)
- Code splitting: Chat and Learn views loaded on demand
- Lazy loading: Components load as needed
- Optimistic updates: Immediate UI feedback

## 🧪 Testing

### Automated Test Suite ✅
Comprehensive test coverage with **250+ tests**:
- **State Transitions**: Course lifecycle, data integrity
- **Persistence**: IndexedDB storage, reload survival
- **Module Progress**: Progress tracking, completion logic
- **Chat Operations**: CRUD operations, message handling
- **Integration**: Cross-feature interactions
- **Edge Cases**: Boundary conditions, large datasets

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run with UI
npm run test:ui
```

See `TESTING.md` for complete testing guide.

## 🚧 Known Limitations

### Post-Launch Improvements
1. **Course Modal**: Placeholder UI, needs full refactor
2. **Firebase Sync**: Basic sync works, conflict resolution needed
3. **Attachment Storage**: Base64 for now, should use IndexedDB blobs
4. **Tests**: No automated tests yet

See `DEPLOYMENT_READY.md` for full details.

## 📝 Development

### Commands
```bash
npm run dev          # Start dev server (http://localhost:5173)
npm run build        # Production build
npm run preview      # Preview production build
npm run lint         # Run ESLint
```

### Environment
- Node.js 18+
- npm 9+

### Code Style
- ESLint for linting
- JSDoc for type annotations
- Prettier-style formatting

## 🔄 Migration from v1

Users with existing localStorage data will automatically migrate to IndexedDB on first load. The migration:
- Preserves all conversations and messages
- Migrates settings and preferences
- Tracks completion in localStorage
- Zero data loss

## 🌐 Deployment

### Build
```bash
npm run build
```

Outputs to `dist/` folder.

### Hosting
Compatible with:
- Vercel
- Netlify
- Cloudflare Pages
- Any static hosting

### Environment Variables
None required for basic operation. Optional:
- Firebase config (for cloud sync)
- Custom API endpoints

## 🔐 Security

### API Keys
- Stored locally in IndexedDB
- Never sent to backend (direct API calls)
- Optional E2EE for Firebase sync

### Data Privacy
- All data stored locally by default
- Optional cloud sync with Firebase
- E2EE available for Firebase messages

## 📚 Documentation

- `DEPLOYMENT_READY.md` - Deployment guide and testing checklist
- `IMPLEMENTATION_STATUS.md` - Architecture details and implementation notes
- `FINAL_STEPS.md` - Original implementation plan
- `TODO.md` - User-maintained task list

## 🤝 Contributing

This is a personal project, but suggestions and feedback are welcome!

## 📄 License

MIT

## 🙏 Acknowledgments

- Google Gemini for AI capabilities
- OpenAI for GPT models
- Dexie.js for IndexedDB wrapper
- TanStack Query for async state
- Zustand for state management
- Tailwind CSS for styling

---

**Status**: ✅ Production Ready
**Version**: 2.0.0
**Last Updated**: 2025-10-26
