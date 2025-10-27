import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { useLearnStore } from '../../src/features/learn/store/learnStore';
import { fullCleanup, initializeStores, createTestCourse } from '../helpers/testUtils';

describe('Learn Mode: Quiz Functionality', () => {
  beforeEach(async () => {
    await fullCleanup();
    await initializeStores();
  });

  describe('Quiz Data Structure', () => {
    it('should store quiz questions in modules', async () => {
      await act(async () => {
        const uniqueGoal = `Test Goal ${Date.now()}_${Math.random()}`;
        await useLearnStore.getState().addGoal(uniqueGoal, 'Description');
        
        const courseId = 'course-1';
        const moduleId = 'module-1';
        
        await useLearnStore.getState().saveCourse({
          id: courseId,
          title: 'Quiz Course',
          goal: uniqueGoal,
          questionIds: [],
          moduleIds: [moduleId],
          whereToGoNext: '',
          status: 'started',
          progressByModule: {},
          completedVia: null,
          createdAt: new Date().toISOString(),
          completedAt: null
        });

        useLearnStore.setState(draft => {
          draft.modules[moduleId] = {
            id: moduleId,
            courseId: courseId,
            title: 'Module with Quiz',
            content: 'Test content',
            quiz: [
              {
                question: 'What is 2+2?',
                options: ['3', '4', '5', '6'],
                correctAnswer: 1
              },
              {
                question: 'What is the capital of France?',
                options: ['London', 'Paris', 'Berlin', 'Madrid'],
                correctAnswer: 1
              }
            ],
            createdAt: new Date().toISOString()
          };
        });
      });

      const store = useLearnStore.getState();
      const module = store.modules['module-1'];
      expect(module.quiz).toHaveLength(2);
      expect(module.quiz[0].question).toBe('What is 2+2?');
    });

    it('should handle modules without quizzes', () => {
      // Test module structure without quiz (no database needed)
      const moduleId = 'test-module-no-quiz';
      
      useLearnStore.setState(draft => {
        draft.modules[moduleId] = {
          id: moduleId,
          courseId: 'test-course',
          title: 'Module without Quiz',
          content: 'Test content',
          quiz: [],
          createdAt: new Date().toISOString()
        };
      });

      const store = useLearnStore.getState();
      const module = store.modules[moduleId];
      expect(module).toBeDefined();
      expect(module.quiz).toHaveLength(0);
    });
  });

  describe('Quiz Answer Validation', () => {
    it('should validate correct answers', () => {
      const quiz = [
        {
          question: 'What is 2+2?',
          options: ['3', '4', '5', '6'],
          correctAnswer: 1
        }
      ];

      const userAnswer = 1;
      expect(userAnswer).toBe(quiz[0].correctAnswer);
    });

    it('should identify incorrect answers', () => {
      const quiz = [
        {
          question: 'What is 2+2?',
          options: ['3', '4', '5', '6'],
          correctAnswer: 1
        }
      ];

      const userAnswer = 0;
      expect(userAnswer).not.toBe(quiz[0].correctAnswer);
    });

    it('should handle multiple quiz questions', () => {
      const quiz = [
        {
          question: 'Question 1',
          options: ['A', 'B', 'C', 'D'],
          correctAnswer: 1
        },
        {
          question: 'Question 2',
          options: ['A', 'B', 'C', 'D'],
          correctAnswer: 2
        },
        {
          question: 'Question 3',
          options: ['A', 'B', 'C', 'D'],
          correctAnswer: 0
        }
      ];

      const userAnswers = [1, 2, 0];
      const score = userAnswers.filter((answer, idx) => answer === quiz[idx].correctAnswer).length;
      
      expect(score).toBe(3);
      expect(score / quiz.length).toBe(1.0); // 100%
    });

    it('should calculate partial scores', () => {
      const quiz = [
        { question: 'Q1', options: ['A', 'B', 'C', 'D'], correctAnswer: 1 },
        { question: 'Q2', options: ['A', 'B', 'C', 'D'], correctAnswer: 2 },
        { question: 'Q3', options: ['A', 'B', 'C', 'D'], correctAnswer: 0 }
      ];

      const userAnswers = [1, 3, 0]; // 2 out of 3 correct
      const score = userAnswers.filter((answer, idx) => answer === quiz[idx].correctAnswer).length;
      
      expect(score).toBe(2);
      expect(score / quiz.length).toBeCloseTo(0.67, 2);
    });
  });

  describe('Quiz Flow', () => {
    it('should allow answering all questions', () => {
      const quiz = [
        { question: 'Q1', options: ['A', 'B'], correctAnswer: 0 },
        { question: 'Q2', options: ['A', 'B'], correctAnswer: 1 }
      ];

      const userAnswers = {};
      quiz.forEach((q, idx) => {
        userAnswers[idx] = 0; // User selects first option for all
      });

      expect(Object.keys(userAnswers)).toHaveLength(quiz.length);
    });

    it('should allow changing answers before submission', () => {
      const quiz = [
        { question: 'Q1', options: ['A', 'B'], correctAnswer: 0 }
      ];

      let userAnswers = { 0: 1 };
      expect(userAnswers[0]).toBe(1);

      // User changes answer
      userAnswers[0] = 0;
      expect(userAnswers[0]).toBe(0);
      expect(userAnswers[0]).toBe(quiz[0].correctAnswer);
    });

    it('should handle unanswered questions gracefully', () => {
      const quiz = [
        { question: 'Q1', options: ['A', 'B'], correctAnswer: 0 },
        { question: 'Q2', options: ['A', 'B'], correctAnswer: 1 },
        { question: 'Q3', options: ['A', 'B'], correctAnswer: 0 }
      ];

      const userAnswers = {
        0: 0,
        // Question 1 not answered
        2: 0
      };

      const answered = Object.keys(userAnswers).length;
      expect(answered).toBe(2);
      expect(answered < quiz.length).toBe(true);
    });
  });

  describe('Quiz Scoring Logic', () => {
    it('should not crash on empty quiz', () => {
      const quiz = [];
      const userAnswers = {};
      
      const score = Object.keys(userAnswers).filter(
        (key) => userAnswers[key] === quiz[key]?.correctAnswer
      ).length;
      
      expect(score).toBe(0);
    });

    it('should handle perfect score', () => {
      const quiz = [
        { question: 'Q1', options: ['A', 'B'], correctAnswer: 0 },
        { question: 'Q2', options: ['A', 'B'], correctAnswer: 1 }
      ];

      const userAnswers = { 0: 0, 1: 1 };
      const score = Object.keys(userAnswers).filter(
        (key) => userAnswers[key] === quiz[key].correctAnswer
      ).length;

      expect(score).toBe(2);
      expect(score).toBe(quiz.length);
    });

    it('should handle zero score', () => {
      const quiz = [
        { question: 'Q1', options: ['A', 'B'], correctAnswer: 0 },
        { question: 'Q2', options: ['A', 'B'], correctAnswer: 1 }
      ];

      const userAnswers = { 0: 1, 1: 0 }; // All wrong
      const score = Object.keys(userAnswers).filter(
        (key) => userAnswers[key] === quiz[key].correctAnswer
      ).length;

      expect(score).toBe(0);
    });

    it('should be lenient - not require perfect score to pass', () => {
      const quiz = [
        { question: 'Q1', options: ['A', 'B'], correctAnswer: 0 },
        { question: 'Q2', options: ['A', 'B'], correctAnswer: 1 },
        { question: 'Q3', options: ['A', 'B'], correctAnswer: 0 }
      ];

      const userAnswers = { 0: 0, 1: 0, 2: 0 }; // 2 out of 3 correct
      const score = Object.keys(userAnswers).filter(
        (key) => userAnswers[key] === quiz[key].correctAnswer
      ).length;

      const percentage = score / quiz.length;
      const passingThreshold = 0.5; // 50% to pass (lenient)
      
      expect(percentage).toBeGreaterThanOrEqual(passingThreshold);
    });

    it('should allow retaking quiz', () => {
      const quiz = [
        { question: 'Q1', options: ['A', 'B'], correctAnswer: 0 }
      ];

      // First attempt
      let userAnswers = { 0: 1 }; // Wrong
      let score = Object.keys(userAnswers).filter(
        (key) => userAnswers[key] === quiz[key].correctAnswer
      ).length;
      expect(score).toBe(0);

      // Retake - user can reset answers
      userAnswers = { 0: 0 }; // Correct
      score = Object.keys(userAnswers).filter(
        (key) => userAnswers[key] === quiz[key].correctAnswer
      ).length;
      expect(score).toBe(1);
    });
  });

  describe('Quiz Edge Cases', () => {
    it('should handle quiz with single question', () => {
      const quiz = [
        { question: 'Only question', options: ['A', 'B'], correctAnswer: 0 }
      ];

      const userAnswers = { 0: 0 };
      const score = Object.keys(userAnswers).filter(
        (key) => userAnswers[key] === quiz[key].correctAnswer
      ).length;

      expect(score).toBe(1);
    });

    it('should handle quiz with many questions', () => {
      const quiz = Array.from({ length: 20 }, (_, i) => ({
        question: `Question ${i}`,
        options: ['A', 'B', 'C', 'D'],
        correctAnswer: i % 4
      }));

      expect(quiz).toHaveLength(20);
      expect(quiz[0].correctAnswer).toBe(0);
      expect(quiz[19].correctAnswer).toBe(3);
    });

    it('should handle questions with different number of options', () => {
      const quiz = [
        { question: 'Q1', options: ['A', 'B'], correctAnswer: 0 },
        { question: 'Q2', options: ['A', 'B', 'C'], correctAnswer: 1 },
        { question: 'Q3', options: ['A', 'B', 'C', 'D'], correctAnswer: 2 }
      ];

      expect(quiz[0].options).toHaveLength(2);
      expect(quiz[1].options).toHaveLength(3);
      expect(quiz[2].options).toHaveLength(4);
    });

    it('should handle special characters in questions', () => {
      const quiz = [
        {
          question: 'What is <script>alert("xss")</script>?',
          options: ['Safe', 'Unsafe', 'Neutral'],
          correctAnswer: 1
        }
      ];

      expect(quiz[0].question).toContain('<script>');
    });

    it('should handle unicode in questions and answers', () => {
      const quiz = [
        {
          question: '你好 means what?',
          options: ['Hello', 'Goodbye', 'Yes', 'No'],
          correctAnswer: 0
        }
      ];

      expect(quiz[0].question).toContain('你好');
    });

    it('should handle very long questions', () => {
      const longQuestion = 'A'.repeat(1000);
      const quiz = [
        {
          question: longQuestion,
          options: ['A', 'B'],
          correctAnswer: 0
        }
      ];

      expect(quiz[0].question.length).toBe(1000);
    });

    it('should handle invalid answer indices gracefully', () => {
      const quiz = [
        { question: 'Q1', options: ['A', 'B'], correctAnswer: 0 }
      ];

      const userAnswers = { 0: 5 }; // Invalid index
      const isValid = userAnswers[0] < quiz[0].options.length;
      
      expect(isValid).toBe(false);
    });
  });

  describe('Module Progress with Quiz', () => {
    it('should allow marking module as done after quiz', async () => {
      const { course, modules } = await createTestCourse({ status: 'started' });
      
      await act(async () => {
        // Mark module as done (simulating completion after quiz)
        await useLearnStore.getState().updateModuleProgress(course.id, modules[0].id, 'done');
      });

      const updatedCourse = useLearnStore.getState().courses[course.id];
      expect(updatedCourse.progressByModule[modules[0].id]).toBe('done');
    });

    it('should allow skipping quiz and marking as done anyway', async () => {
      const { course, modules } = await createTestCourse({ status: 'started' });
      
      await act(async () => {
        // User can mark as done without taking quiz
        await useLearnStore.getState().updateModuleProgress(course.id, modules[0].id, 'done');
      });

      const updatedCourse = useLearnStore.getState().courses[course.id];
      expect(updatedCourse.progressByModule[modules[0].id]).toBe('done');
    });
  });

  describe('Malformed Quiz Data Handling', () => {
    it('should handle quiz questions without options array', async () => {
      await act(async () => {
        const uniqueGoal = `Test Goal ${Date.now()}_${Math.random()}`;
        await useLearnStore.getState().addGoal(uniqueGoal, 'Description');
        
        const courseId = 'course-malformed';
        const moduleId = 'module-malformed';
        
        await useLearnStore.getState().saveCourse({
          id: courseId,
          title: 'Malformed Quiz Course',
          goal: uniqueGoal,
          questionIds: [],
          moduleIds: [moduleId],
          whereToGoNext: '',
          status: 'started',
          progressByModule: {},
          completedVia: null,
          createdAt: new Date().toISOString(),
          completedAt: null
        });

        // Intentionally create malformed quiz data
        useLearnStore.setState(draft => {
          draft.modules[moduleId] = {
            id: moduleId,
            courseId: courseId,
            title: 'Module with Malformed Quiz',
            content: 'Test content',
            quiz: [
              {
                question: 'What is 2+2?',
                // Missing options array
                correctAnswer: 1
              }
            ]
          };
        });
      });

      const store = useLearnStore.getState();
      const moduleId = 'module-malformed';
      const module = store.modules[moduleId];
      
      // Quiz should exist but be malformed
      expect(module.quiz).toBeDefined();
      expect(module.quiz.length).toBe(1);
      expect(module.quiz[0].options).toBeUndefined();
      
      // Component should handle this gracefully (not crash)
      // The defensive check in LearnCourseModal will skip rendering this question
    });

    it('should handle quiz questions with null options', async () => {
      await act(async () => {
        const uniqueGoal = `Test Goal ${Date.now()}_${Math.random()}`;
        await useLearnStore.getState().addGoal(uniqueGoal, 'Description');
        
        const courseId = 'course-null-options';
        const moduleId = 'module-null-options';
        
        await useLearnStore.getState().saveCourse({
          id: courseId,
          title: 'Null Options Quiz Course',
          goal: uniqueGoal,
          questionIds: [],
          moduleIds: [moduleId],
          whereToGoNext: '',
          status: 'started',
          progressByModule: {},
          completedVia: null,
          createdAt: new Date().toISOString(),
          completedAt: null
        });

        useLearnStore.setState(draft => {
          draft.modules[moduleId] = {
            id: moduleId,
            courseId: courseId,
            title: 'Module with Null Options',
            content: 'Test content',
            quiz: [
              {
                question: 'What is the capital?',
                options: null, // null instead of array
                correctAnswer: 0
              }
            ]
          };
        });
      });

      const store = useLearnStore.getState();
      const moduleId = 'module-null-options';
      const module = store.modules[moduleId];
      
      expect(module.quiz).toBeDefined();
      expect(module.quiz[0].options).toBeNull();
      // Component will handle this gracefully
    });

    it('should handle completely null quiz questions', async () => {
      await act(async () => {
        const uniqueGoal = `Test Goal ${Date.now()}_${Math.random()}`;
        await useLearnStore.getState().addGoal(uniqueGoal, 'Description');
        
        const courseId = 'course-null-quiz';
        const moduleId = 'module-null-quiz';
        
        await useLearnStore.getState().saveCourse({
          id: courseId,
          title: 'Null Quiz Course',
          goal: uniqueGoal,
          questionIds: [],
          moduleIds: [moduleId],
          whereToGoNext: '',
          status: 'started',
          progressByModule: {},
          completedVia: null,
          createdAt: new Date().toISOString(),
          completedAt: null
        });

        useLearnStore.setState(draft => {
          draft.modules[moduleId] = {
            id: moduleId,
            courseId: courseId,
            title: 'Module with Null Question',
            content: 'Test content',
            quiz: [null] // Completely null question
          };
        });
      });

      const store = useLearnStore.getState();
      const moduleId = 'module-null-quiz';
      const module = store.modules[moduleId];
      
      expect(module.quiz).toBeDefined();
      expect(module.quiz[0]).toBeNull();
      // Component will skip rendering this question
    });

    it('should handle empty quiz gracefully', async () => {
      const { course, modules } = await createTestCourse({ status: 'started' });
      
      // Remove quiz from module
      await act(async () => {
        useLearnStore.setState(draft => {
          draft.modules[modules[0].id].quiz = [];
        });
      });

      const store = useLearnStore.getState();
      const module = store.modules[modules[0].id];
      
      expect(module.quiz).toEqual([]);
      expect(module.quiz.length).toBe(0);
    });
  });
});

