# 🎯 LOOM User Testing Guide

Thank you for testing LOOM! This should take about **15-20 minutes**.

---

## 📦 STEP 1: Installation

### For Mac Users:
1. Download the zip file from: [Google Drive Link](https://drive.google.com/file/d/194ywKdYEwQNh9h994mOiKvWAlpmmGj6m/view?usp=sharing)
2. Extract the zip file (double-click it)
3. Open the `dist` folder
4. **RIGHT-CLICK** on `START_SERVER.command` (don't double-click!)
5. Select **"Open"** from the menu
6. Click **"Open"** again in the security dialog
7. Your browser will open automatically to http://localhost:8080

**Alternative (if above doesn't work):**
- Open Terminal
- Type: `cd ` (with space), then drag the `dist` folder into Terminal
- Press Enter
- Type: `python3 -m http.server 8080`
- Open browser to: http://localhost:8080

### For Windows Users:
1. Download and extract the zip file
2. Open the `dist` folder
3. Double-click `START_SERVER.bat`
4. Your browser will open automatically to http://localhost:8080

**Alternative (if Python not found):**
- Install Python from python.org first, then try again

---

## 🔑 STEP 2: First-Time Setup (Required)

1. Click the **Settings icon** (⚙️ gear icon in top right)
2. Get a **FREE Gemini API key**:
   - Go to: https://ai.google.dev/
   - Click "Get API Key" → Sign in with Google → Create new key
   - Copy the key
3. Paste the API key into the Settings dialog
4. Click **Save**

✅ You're ready to test!

---

## ✨ STEP 3: Understanding LOOM

LOOM has **two modes**:

### 💬 **CHAT Mode** (Default view)
- Use it like ChatGPT - ask questions, have conversations
- Supports multiple AI models (Gemini 2.5 Pro/Flash, GPT-4o-mini)
- Can attach images and PDFs
- All conversations are saved automatically

### 📚 **LEARN Mode** (Click "Learn" in top navigation)
- **Automatically analyzes your chat history** to identify learning opportunities
- Suggests personalized course topics based on what you've discussed
- Creates structured learning paths with modules and quizzes
- Helps you consolidate and expand your knowledge

**How it works:** As you chat, LOOM tracks what you're learning about. When you switch to Learn mode, it suggests relevant topics and creates mini-courses to help you master those subjects.

---

## 🧪 STEP 4: Testing Tasks

### Task 1: Have Natural Conversations (10+ messages)

**Use Chat mode like you normally use ChatGPT.** Focus on topics you'd typically ask about:

**Examples:**
- 📖 **Learning/School:** "Explain how neural networks work", "Help me understand photosynthesis", "What's the difference between REST and GraphQL?"
- 💼 **Work:** "How do I write a professional email to decline a meeting?", "Explain agile methodology"
- 🤔 **Curiosity:** "Why is the sky blue?", "How does blockchain work?", "What causes inflation?"
- 🛠️ **Problem-solving:** "Debug this code...", "How do I fix a leaky faucet?", "Recipe for pad thai"

**Goal:** Have at least **10 back-and-forth messages** on topics you're genuinely interested in learning about.

### Task 2: Explore Learn Mode

1. Click **"Learn"** in the top navigation
2. Click **"Refresh Suggestions"** button (top right)
3. Wait a few seconds while LOOM analyzes your chats
4. Review the suggested course topics
5. Click on a suggested topic to see the full course outline
6. Explore the modules, lessons, and quizzes

---

## 📝 STEP 5: Feedback Survey

After testing, please answer these questions:

### Rate your experience (1 = Strongly Disagree, 7 = Strongly Agree):

1. The system's suggested topics were useful to my needs.
2. The suggestions repeated things I already knew. *(lower is better)*
3. The suggestions helped consolidate my prior knowledge.
4. The system introduced new information that expanded my knowledge.
5. The system identified gaps I would not have noticed on my own.
6. The length and depth of suggested lessons matched the time I usually spend learning.
7. The presented materials felt coherent and connected to my prior chats.
8. I trust the correctness of the suggested content.
9. I felt motivated to follow up after viewing the suggestions.
10. I would use this system again in my daily workflows.

### Open-ended questions:

11. **What did you like most** about the suggestions/materials?
12. **What would you change** to make suggestions/materials more useful?

---

## ⚠️ Troubleshooting

**Blank white screen?**
- Make sure you're running the local server (not just opening index.html)
- Check that you're at http://localhost:8080

**"API key required" error?**
- Go to Settings and add your Gemini API key

**Port 8080 already in use?**
- Try: `python3 -m http.server 8081` and open http://localhost:8081

**No suggestions appearing in Learn mode?**
- Make sure you've had at least 10 chat messages first
- Click "Refresh Suggestions" button
- Wait a few seconds for processing

---

## 🙏 Thank You!

Your feedback will help improve LOOM. If you encounter any bugs or have questions, please let me know!

**Keep the Terminal/Command Prompt window open** while testing - closing it will stop the server.

---

**Estimated time:** 15-20 minutes  
**Questions?** Contact Justin

