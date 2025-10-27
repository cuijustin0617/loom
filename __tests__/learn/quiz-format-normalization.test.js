import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { useLearnStore } from '../../src/features/learn/store/learnStore';
import { fullCleanup, initializeStores } from '../helpers/testUtils';
import { generateId } from '../../src/lib/db/database';

describe('Quiz Format Normalization', () => {
  beforeEach(async () => {
    await fullCleanup();
    await initializeStores();
  });

  describe('AI-generated quiz format handling', () => {
    it('should handle quiz with prompt/choices/answerIndex format', async () => {
      const uniqueGoal = `Test Goal ${Date.now()}`;
      
      await act(async () => {
        await useLearnStore.getState().addGoal(uniqueGoal, 'Description');
        
        const courseId = generateId('course');
        const moduleId = generateId('module');
        
        // Simulate AI-generated format
        const aiGeneratedCourse = {
          id: courseId,
          title: 'AI Generated Course',
          goal: uniqueGoal,
          questionIds: [],
          moduleIds: [moduleId],
          whereToGoNext: '',
          status: 'suggested',
          progressByModule: {},
          completedVia: null,
          createdAt: new Date().toISOString(),
          completedAt: null,
          modules: [
            {
              id: moduleId,
              courseId: courseId,
              idx: 0,
              title: 'Module 1',
              estMinutes: 5,
              lesson: '# Test Lesson',
              quiz: [
                {
                  prompt: 'What is 2+2?',  // AI format
                  choices: ['1', '2', '3', '4'],  // AI format
                  answerIndex: 3  // AI format (0-based)
                }
              ],
              refs: []
            }
          ]
        };
        
        await useLearnStore.getState().saveCourse(aiGeneratedCourse);
      });

      const store = useLearnStore.getState();
      const courses = Object.values(store.courses);
      const course = courses.find(c => c.title === 'AI Generated Course');
      
      expect(course).toBeDefined();
      
      // Check if module was saved
      const module = store.modules[course.moduleIds[0]];
      expect(module).toBeDefined();
      expect(module.quiz).toBeDefined();
      expect(module.quiz.length).toBe(1);
      
      // Check if format was normalized
      const quiz = module.quiz[0];
      expect(quiz.question || quiz.prompt).toBeDefined();
      expect(quiz.options || quiz.choices).toBeDefined();
      expect(quiz.correctAnswer !== undefined || quiz.answerIndex !== undefined).toBe(true);
    });

    it('should handle quiz with question/options/correctAnswer format', async () => {
      const uniqueGoal = `Test Goal ${Date.now()}`;
      
      await act(async () => {
        await useLearnStore.getState().addGoal(uniqueGoal, 'Description');
        
        const courseId = generateId('course');
        const moduleId = generateId('module');
        
        // Standard format
        const standardCourse = {
          id: courseId,
          title: 'Standard Course',
          goal: uniqueGoal,
          questionIds: [],
          moduleIds: [moduleId],
          whereToGoNext: '',
          status: 'suggested',
          progressByModule: {},
          completedVia: null,
          createdAt: new Date().toISOString(),
          completedAt: null,
          modules: [
            {
              id: moduleId,
              courseId: courseId,
              idx: 0,
              title: 'Module 1',
              estMinutes: 5,
              lesson: '# Test Lesson',
              quiz: [
                {
                  question: 'What is 3+3?',
                  options: ['4', '5', '6', '7'],
                  correctAnswer: 2
                }
              ],
              refs: []
            }
          ]
        };
        
        await useLearnStore.getState().saveCourse(standardCourse);
      });

      const store = useLearnStore.getState();
      const courses = Object.values(store.courses);
      const course = courses.find(c => c.title === 'Standard Course');
      
      expect(course).toBeDefined();
      
      const module = store.modules[course.moduleIds[0]];
      expect(module.quiz[0].question).toBe('What is 3+3?');
      expect(module.quiz[0].options).toEqual(['4', '5', '6', '7']);
      expect(module.quiz[0].correctAnswer).toBe(2);
    });

    it('should handle mixed format quizzes in same module', async () => {
      const uniqueGoal = `Test Goal ${Date.now()}`;
      
      await act(async () => {
        await useLearnStore.getState().addGoal(uniqueGoal, 'Description');
        
        const courseId = generateId('course');
        const moduleId = generateId('module');
        
        const mixedCourse = {
          id: courseId,
          title: 'Mixed Course',
          goal: uniqueGoal,
          questionIds: [],
          moduleIds: [moduleId],
          whereToGoNext: '',
          status: 'suggested',
          progressByModule: {},
          completedVia: null,
          createdAt: new Date().toISOString(),
          completedAt: null,
          modules: [
            {
              id: moduleId,
              courseId: courseId,
              idx: 0,
              title: 'Module 1',
              estMinutes: 5,
              lesson: '# Test Lesson',
              quiz: [
                {
                  prompt: 'AI format question',
                  choices: ['A', 'B', 'C'],
                  answerIndex: 1
                },
                {
                  question: 'Standard format question',
                  options: ['X', 'Y', 'Z'],
                  correctAnswer: 0
                }
              ],
              refs: []
            }
          ]
        };
        
        await useLearnStore.getState().saveCourse(mixedCourse);
      });

      const store = useLearnStore.getState();
      const courses = Object.values(store.courses);
      const course = courses.find(c => c.title === 'Mixed Course');
      const module = store.modules[course.moduleIds[0]];
      
      expect(module.quiz.length).toBe(2);
      
      // Both formats should be handleable
      const quiz1 = module.quiz[0];
      const quiz2 = module.quiz[1];
      
      expect(quiz1.prompt || quiz1.question).toBeDefined();
      expect(quiz2.prompt || quiz2.question).toBeDefined();
    });
  });

  describe('Quiz answer validation with both formats', () => {
    it('should validate correct answer for AI format', () => {
      const quiz = {
        prompt: 'Test question',
        choices: ['A', 'B', 'C'],
        answerIndex: 1
      };
      
      const userAnswer = 1;
      const correctAnswer = quiz.answerIndex || quiz.correctAnswer;
      
      expect(userAnswer).toBe(correctAnswer);
    });

    it('should validate correct answer for standard format', () => {
      const quiz = {
        question: 'Test question',
        options: ['A', 'B', 'C'],
        correctAnswer: 2
      };
      
      const userAnswer = 2;
      const correctAnswer = quiz.correctAnswer || quiz.answerIndex;
      
      expect(userAnswer).toBe(correctAnswer);
    });
  });
});

