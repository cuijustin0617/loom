/**
 * Learn Mode Module Progress Tests
 * 
 * Tests module progress tracking and course completion logic
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { setupTestEnvironment, createTestCourse, fullCleanup, initializeStores } from '../helpers/testUtils';
import { useLearnStore } from '../../src/features/learn/store/learnStore';

describe('Learn Mode: Module Progress', () => {
  beforeEach(async () => {
    await setupTestEnvironment();
  });

  describe('Progress Tracking', () => {
    it('should initialize modules with no progress', async () => {
      const { course, modules } = await createTestCourse();
      
      const courseData = useLearnStore.getState().getCourseWithModules(course.id);
      expect(courseData.progressByModule).toEqual({});
      expect(courseData.status).toBe('started');
    });

    it('should update single module progress', async () => {
      const { course, modules } = await createTestCourse();
      
      await act(async () => {
        await useLearnStore.getState().updateModuleProgress(
          course.id,
          modules[0].id,
          'done'
        );
      });
      
      const courseData = useLearnStore.getState().getCourseWithModules(course.id);
      expect(courseData.progressByModule[modules[0].id]).toBe('done');
      expect(courseData.progressByModule[modules[1].id]).toBeUndefined();
      expect(courseData.status).toBe('started');
    });

    it('should update multiple modules independently', async () => {
      const { course, modules } = await createTestCourse();
      
      await act(async () => {
        await useLearnStore.getState().updateModuleProgress(course.id, modules[0].id, 'done');
        await useLearnStore.getState().updateModuleProgress(course.id, modules[1].id, 'in_progress');
      });
      
      const courseData = useLearnStore.getState().getCourseWithModules(course.id);
      expect(courseData.progressByModule[modules[0].id]).toBe('done');
      expect(courseData.progressByModule[modules[1].id]).toBe('in_progress');
    });

    it('should persist module progress after reload', async () => {
      const { course, modules } = await createTestCourse();
      
      await act(async () => {
        await useLearnStore.getState().updateModuleProgress(course.id, modules[0].id, 'done');
      });
      
      await fullCleanup();
      await initializeStores();
      
      const courseData = useLearnStore.getState().getCourseWithModules(course.id);
      expect(courseData.progressByModule[modules[0].id]).toBe('done');
    });

    it('should allow progress to be updated multiple times', async () => {
      const { course, modules } = await createTestCourse();
      
      await act(async () => {
        // not_started → in_progress
        await useLearnStore.getState().updateModuleProgress(course.id, modules[0].id, 'in_progress');
      });
      
      let courseData = useLearnStore.getState().getCourseWithModules(course.id);
      expect(courseData.progressByModule[modules[0].id]).toBe('in_progress');
      
      await act(async () => {
        // in_progress → done
        await useLearnStore.getState().updateModuleProgress(course.id, modules[0].id, 'done');
      });
      
      courseData = useLearnStore.getState().getCourseWithModules(course.id);
      expect(courseData.progressByModule[modules[0].id]).toBe('done');
    });
  });

  describe('Course Completion', () => {
    it('should mark course as completed when all modules done', async () => {
      const { course, modules } = await createTestCourse();
      
      // Mark all modules as done
      await act(async () => {
        for (const module of modules) {
          await useLearnStore.getState().updateModuleProgress(course.id, module.id, 'done');
        }
      });
      
      const courseData = useLearnStore.getState().getCourseWithModules(course.id);
      expect(courseData.status).toBe('completed');
      expect(courseData.completedAt).toBeTruthy();
    });

    it('should not mark as completed if any module is incomplete', async () => {
      const { course, modules } = await createTestCourse();
      
      // Mark only first module as done
      await act(async () => {
        await useLearnStore.getState().updateModuleProgress(course.id, modules[0].id, 'done');
      });
      
      const courseData = useLearnStore.getState().getCourseWithModules(course.id);
      expect(courseData.status).toBe('started');
      expect(courseData.completedAt).toBeNull();
    });

    it('should move from Continue to Completed section', async () => {
      const { course, modules } = await createTestCourse();
      
      let started = useLearnStore.getState().getStartedCourses();
      let completed = useLearnStore.getState().getCompletedCourses();
      expect(started).toHaveLength(1);
      expect(completed).toHaveLength(0);
      
      // Complete all modules
      await act(async () => {
        for (const module of modules) {
          await useLearnStore.getState().updateModuleProgress(course.id, module.id, 'done');
        }
      });
      
      started = useLearnStore.getState().getStartedCourses();
      completed = useLearnStore.getState().getCompletedCourses();
      expect(started).toHaveLength(0);
      expect(completed).toHaveLength(1);
    });

    it('should persist completed status after reload', async () => {
      const { course, modules } = await createTestCourse();
      
      await act(async () => {
        for (const module of modules) {
          await useLearnStore.getState().updateModuleProgress(course.id, module.id, 'done');
        }
      });
      
      await fullCleanup();
      await initializeStores();
      
      const completed = useLearnStore.getState().getCompletedCourses();
      expect(completed).toHaveLength(1);
      expect(completed[0].id).toBe(course.id);
      expect(completed[0].status).toBe('completed');
    });

    it('should preserve all module progress in completed course', async () => {
      const { course, modules } = await createTestCourse();
      
      await act(async () => {
        for (const module of modules) {
          await useLearnStore.getState().updateModuleProgress(course.id, module.id, 'done');
        }
      });
      
      const courseData = useLearnStore.getState().getCourseWithModules(course.id);
      expect(Object.keys(courseData.progressByModule)).toHaveLength(modules.length);
      
      for (const module of modules) {
        expect(courseData.progressByModule[module.id]).toBe('done');
      }
    });
  });

  describe('Progress Calculation', () => {
    it('should calculate completion percentage correctly', async () => {
      const { course, modules } = await createTestCourse();
      
      // 0% complete
      let courseData = useLearnStore.getState().getCourseWithModules(course.id);
      let completedCount = Object.values(courseData.progressByModule).filter(p => p === 'done').length;
      expect(completedCount / modules.length).toBe(0);
      
      // 50% complete
      await act(async () => {
        await useLearnStore.getState().updateModuleProgress(course.id, modules[0].id, 'done');
      });
      
      courseData = useLearnStore.getState().getCourseWithModules(course.id);
      completedCount = Object.values(courseData.progressByModule).filter(p => p === 'done').length;
      expect(completedCount / modules.length).toBe(0.5);
      
      // 100% complete
      await act(async () => {
        await useLearnStore.getState().updateModuleProgress(course.id, modules[1].id, 'done');
      });
      
      courseData = useLearnStore.getState().getCourseWithModules(course.id);
      completedCount = Object.values(courseData.progressByModule).filter(p => p === 'done').length;
      expect(completedCount / modules.length).toBe(1);
    });

    it('should track progress across multiple courses independently', async () => {
      const { course: course1, modules: modules1 } = await createTestCourse({ title: 'Course 1' });
      const { course: course2, modules: modules2 } = await createTestCourse({ title: 'Course 2' });
      
      // Progress course 1
      await act(async () => {
        await useLearnStore.getState().updateModuleProgress(course1.id, modules1[0].id, 'done');
      });
      
      // Progress course 2
      await act(async () => {
        await useLearnStore.getState().updateModuleProgress(course2.id, modules2[0].id, 'done');
        await useLearnStore.getState().updateModuleProgress(course2.id, modules2[1].id, 'done');
      });
      
      const course1Data = useLearnStore.getState().getCourseWithModules(course1.id);
      const course2Data = useLearnStore.getState().getCourseWithModules(course2.id);
      
      expect(course1Data.status).toBe('started');
      expect(course2Data.status).toBe('completed');
    });
  });

  describe('Edge Cases', () => {
    it('should handle module progress for course with many modules', async () => {
      const courseId = 'course-many-modules';
      const moduleIds = Array.from({ length: 20 }, (_, i) => `mod-${i}`);
      
      const course = {
        id: courseId,
        title: 'Large Course',
        goal: 'Learn Everything',
        questionIds: [],
        moduleIds,
        whereToGoNext: '',
        status: 'started',
        progressByModule: {},
        completedVia: null,
        createdAt: new Date().toISOString(),
        completedAt: null
      };
      
      const modules = moduleIds.map((id, idx) => ({
        id,
        courseId,
        idx,
        title: `Module ${idx + 1}`,
        estMinutes: 5,
        lesson: `Content ${idx}`,
        microTask: '',
        quiz: [],
        refs: []
      }));
      
      await useLearnStore.getState().saveCourse({ ...course, modules });
      
      // Mark half as done
      await act(async () => {
        for (let i = 0; i < 10; i++) {
          await useLearnStore.getState().updateModuleProgress(courseId, moduleIds[i], 'done');
        }
      });
      
      let courseData = useLearnStore.getState().getCourseWithModules(courseId);
      expect(courseData.status).toBe('started');
      
      // Mark all as done
      await act(async () => {
        for (let i = 10; i < 20; i++) {
          await useLearnStore.getState().updateModuleProgress(courseId, moduleIds[i], 'done');
        }
      });
      
      courseData = useLearnStore.getState().getCourseWithModules(courseId);
      expect(courseData.status).toBe('completed');
    });

    it('should handle progress update for non-existent module gracefully', async () => {
      const { course } = await createTestCourse();
      
      // Try to update non-existent module
      await act(async () => {
        await useLearnStore.getState().updateModuleProgress(course.id, 'non-existent-module', 'done');
      });
      
      // Should not crash
      const courseData = useLearnStore.getState().getCourseWithModules(course.id);
      expect(courseData).toBeTruthy();
    });

    it('should handle rapid progress updates', async () => {
      const { course, modules } = await createTestCourse();
      
      // Rapid updates to same module
      await act(async () => {
        const promises = [];
        for (let i = 0; i < 10; i++) {
          promises.push(
            useLearnStore.getState().updateModuleProgress(course.id, modules[0].id, 'done')
          );
        }
        await Promise.all(promises);
      });
      
      const courseData = useLearnStore.getState().getCourseWithModules(course.id);
      expect(courseData.progressByModule[modules[0].id]).toBe('done');
    });
  });
});

