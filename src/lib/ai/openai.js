import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: import.meta.env.VITE_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true
});

export const sendOpenAIMessage = async (messages) => {
  try {
    // Strip any non-standard fields (e.g., attachments) for OpenAI
    const mapped = messages.map(m => ({ role: m.role, content: m.content || '' }));
    const completion = await openai.chat.completions.create({
      messages: mapped,
      model: "gpt-4o-mini",
      stream: false,
    });

    return completion.choices[0].message.content;
  } catch (error) {
    throw new Error(`OpenAI API Error: ${error.message}`);
  }
};
