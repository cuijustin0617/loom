import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateFullCourse } from '../../src/features/learn/services/learnApi';
import { fullCleanup, initializeStores } from '../helpers/testUtils';
import { generateId } from '../../src/lib/db/database';

// Mock sendGeminiMessage
vi.mock('../../src/lib/ai/gemini', () => ({
  sendGeminiMessage: vi.fn()
}));

import { sendGeminiMessage } from '../../src/lib/ai/gemini';

describe('Course Generation JSON Validation', () => {
  beforeEach(async () => {
    await fullCleanup();
    await initializeStores();
    vi.clearAllMocks();
  });

  it('should accept valid complete JSON response', async () => {
    const validResponse = JSON.stringify({
      title: 'Test Course',
      goal: 'Test Goal',
      questions_you_will_answer: ['Q1', 'Q2', 'Q3', 'Q4'],
      modules: [
        {
          module_id: 'mod1',
          idx: 1,
          title: 'Module 1',
          est_minutes: 5,
          lesson: 'This is lesson content for module 1.',
          quiz: [
            {
              prompt: 'Question 1?',
              choices: ['A', 'B', 'C', 'D'],
              answer_index: 0
            },
            {
              prompt: 'Question 2?',
              choices: ['A', 'B', 'C'],
              answer_index: 1
            }
          ],
          refs: []
        }
      ],
      where_to_go_next: 'Next steps...'
    });

    sendGeminiMessage.mockResolvedValue(validResponse);

    const outline = {
      courseId: generateId('course'),
      title: 'Test Course',
      questions: ['Q1', 'Q2', 'Q3', 'Q4'],
      moduleSummary: [{ title: 'Module 1', estMinutes: 5 }],
      sourceChatIds: []
    };

    const result = await generateFullCourse({
      outline,
      conversations: [],
      model: 'gemini-2.5-flash'
    });

    expect(result).toBeDefined();
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].lesson).toBeDefined();
  });

  it('should reject JSON with missing modules field', async () => {
    const invalidResponse = JSON.stringify({
      title: 'Test Course',
      goal: 'Test Goal',
      questions_you_will_answer: ['Q1', 'Q2', 'Q3', 'Q4'],
      where_to_go_next: 'Next steps...'
      // Missing modules field!
    });

    sendGeminiMessage.mockResolvedValue(invalidResponse);

    const outline = {
      courseId: generateId('course'),
      title: 'Test Course',
      questions: [],
      moduleSummary: [],
      sourceChatIds: []
    };

    await expect(generateFullCourse({
      outline,
      conversations: [],
      model: 'gemini-2.5-flash'
    })).rejects.toThrow('missing modules field');
  });

  it('should reject JSON with empty modules array', async () => {
    const invalidResponse = JSON.stringify({
      title: 'Test Course',
      goal: 'Test Goal',
      questions_you_will_answer: ['Q1', 'Q2', 'Q3', 'Q4'],
      modules: [], // Empty!
      where_to_go_next: 'Next steps...'
    });

    sendGeminiMessage.mockResolvedValue(invalidResponse);

    const outline = {
      courseId: generateId('course'),
      title: 'Test Course',
      questions: [],
      moduleSummary: [],
      sourceChatIds: []
    };

    await expect(generateFullCourse({
      outline,
      conversations: [],
      model: 'gemini-2.5-flash'
    })).rejects.toThrow('modules array is empty');
  });

  it('should reject module without title', async () => {
    const invalidResponse = JSON.stringify({
      title: 'Test Course',
      goal: 'Test Goal',
      questions_you_will_answer: ['Q1', 'Q2', 'Q3', 'Q4'],
      modules: [
        {
          module_id: 'mod1',
          idx: 1,
          // Missing title!
          est_minutes: 5,
          lesson: 'Lesson content',
          quiz: [],
          refs: []
        }
      ],
      where_to_go_next: 'Next steps...'
    });

    sendGeminiMessage.mockResolvedValue(invalidResponse);

    const outline = {
      courseId: generateId('course'),
      title: 'Test Course',
      questions: [],
      moduleSummary: [],
      sourceChatIds: []
    };

    await expect(generateFullCourse({
      outline,
      conversations: [],
      model: 'gemini-2.5-flash'
    })).rejects.toThrow('missing title');
  });

  it('should reject module without lesson content', async () => {
    const invalidResponse = JSON.stringify({
      title: 'Test Course',
      goal: 'Test Goal',
      questions_you_will_answer: ['Q1', 'Q2', 'Q3', 'Q4'],
      modules: [
        {
          module_id: 'mod1',
          idx: 1,
          title: 'Module 1',
          est_minutes: 5,
          // Missing lesson!
          quiz: [],
          refs: []
        }
      ],
      where_to_go_next: 'Next steps...'
    });

    sendGeminiMessage.mockResolvedValue(invalidResponse);

    const outline = {
      courseId: generateId('course'),
      title: 'Test Course',
      questions: [],
      moduleSummary: [],
      sourceChatIds: []
    };

    await expect(generateFullCourse({
      outline,
      conversations: [],
      model: 'gemini-2.5-flash'
    })).rejects.toThrow('missing lesson content');
  });

  it('should reject module with incomplete quiz', async () => {
    const invalidResponse = JSON.stringify({
      title: 'Test Course',
      goal: 'Test Goal',
      questions_you_will_answer: ['Q1', 'Q2', 'Q3', 'Q4'],
      modules: [
        {
          module_id: 'mod1',
          idx: 1,
          title: 'Module 1',
          est_minutes: 5,
          lesson: 'Lesson content',
          quiz: [
            {
              prompt: 'Question 1?',
              choices: ['A'], // Only 1 choice - incomplete!
              answer_index: 0
            }
          ],
          refs: []
        }
      ],
      where_to_go_next: 'Next steps...'
    });

    sendGeminiMessage.mockResolvedValue(invalidResponse);

    const outline = {
      courseId: generateId('course'),
      title: 'Test Course',
      questions: [],
      moduleSummary: [],
      sourceChatIds: []
    };

    await expect(generateFullCourse({
      outline,
      conversations: [],
      model: 'gemini-2.5-flash'
    })).rejects.toThrow('quiz');
  });

  it('should handle JSON with code fences', async () => {
    const validResponse = '```json\n' + JSON.stringify({
      title: 'Test Course',
      goal: 'Test Goal',
      questions_you_will_answer: ['Q1', 'Q2', 'Q3', 'Q4'],
      modules: [
        {
          module_id: 'mod1',
          idx: 1,
          title: 'Module 1',
          est_minutes: 5,
          lesson: 'Lesson content',
          quiz: [],
          refs: []
        }
      ],
      where_to_go_next: 'Next steps...'
    }) + '\n```';

    sendGeminiMessage.mockResolvedValue(validResponse);

    const outline = {
      courseId: generateId('course'),
      title: 'Test Course',
      questions: [],
      moduleSummary: [],
      sourceChatIds: []
    };

    const result = await generateFullCourse({
      outline,
      conversations: [],
      model: 'gemini-2.5-flash'
    });

    expect(result).toBeDefined();
    expect(result.modules).toHaveLength(1);
  });

  it('should reject completely invalid JSON', async () => {
    const invalidResponse = 'This is not JSON at all!';

    sendGeminiMessage.mockResolvedValue(invalidResponse);

    const outline = {
      courseId: generateId('course'),
      title: 'Test Course',
      questions: [],
      moduleSummary: [],
      sourceChatIds: []
    };

    await expect(generateFullCourse({
      outline,
      conversations: [],
      model: 'gemini-2.5-flash'
    })).rejects.toThrow('could not parse response');
  });

  it('should accept valid quiz with multiple questions', async () => {
    const validResponse = JSON.stringify({
      title: 'Test Course',
      goal: 'Test Goal',
      questions_you_will_answer: ['Q1', 'Q2', 'Q3', 'Q4'],
      modules: [
        {
          module_id: 'mod1',
          idx: 1,
          title: 'Module 1',
          est_minutes: 5,
          lesson: 'Lesson content',
          quiz: [
            {
              prompt: 'Question 1?',
              choices: ['A', 'B', 'C', 'D'],
              answer_index: 0
            },
            {
              prompt: 'Question 2?',
              choices: ['A', 'B', 'C', 'D', 'E'],
              answer_index: 2
            }
          ],
          refs: ['Ref 1', 'Ref 2']
        }
      ],
      where_to_go_next: 'Next steps...'
    });

    sendGeminiMessage.mockResolvedValue(validResponse);

    const outline = {
      courseId: generateId('course'),
      title: 'Test Course',
      questions: [],
      moduleSummary: [],
      sourceChatIds: []
    };

    const result = await generateFullCourse({
      outline,
      conversations: [],
      model: 'gemini-2.5-flash'
    });

    expect(result).toBeDefined();
    expect(result.modules[0].quiz).toHaveLength(2);
    expect(result.modules[0].refs).toHaveLength(2);
  });

  it('should accept module without quiz (optional field)', async () => {
    const validResponse = JSON.stringify({
      title: 'Test Course',
      goal: 'Test Goal',
      questions_you_will_answer: ['Q1', 'Q2', 'Q3', 'Q4'],
      modules: [
        {
          module_id: 'mod1',
          idx: 1,
          title: 'Module 1',
          est_minutes: 5,
          lesson: 'Lesson content',
          // No quiz field
          refs: []
        }
      ],
      where_to_go_next: 'Next steps...'
    });

    sendGeminiMessage.mockResolvedValue(validResponse);

    const outline = {
      courseId: generateId('course'),
      title: 'Test Course',
      questions: [],
      moduleSummary: [],
      sourceChatIds: []
    };

    const result = await generateFullCourse({
      outline,
      conversations: [],
      model: 'gemini-2.5-flash'
    });

    expect(result).toBeDefined();
    expect(result.modules[0].quiz).toHaveLength(0);
  });
});

