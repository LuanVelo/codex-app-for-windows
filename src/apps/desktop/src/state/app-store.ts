import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";
import {
  addThreadMessage,
  cancelTask,
  createProject,
  createThread,
  gitStatus,
  listProjects,
  listTaskLogs,
  listTasks,
  listThreadMessages,
  listThreads,
  runTask,
  touchProject,
} from "../features/mvp/api";
import type {
  GitStatusResult,
  ProjectRecord,
  TaskLogEvent,
  TaskLogRecord,
  TaskRecord,
  TaskStatusEvent,
  ThreadMessage,
  ThreadRecord,
} from "../features/mvp/types";

interface AppStore {
  projects: ProjectRecord[];
  activeProjectId: string;
  threads: ThreadRecord[];
  activeThreadId: string;
  messages: ThreadMessage[];
  tasks: TaskRecord[];
  selectedTaskId: string;
  taskLogs: TaskLogRecord[];
  git: GitStatusResult | null;
  loading: boolean;
  statusText: string;
  listenersReady: boolean;

  init: () => Promise<void>;
  createProject: (path: string, name?: string) => Promise<void>;
  selectProject: (projectId: string) => Promise<void>;
  createThread: (name: string, description?: string) => Promise<void>;
  selectThread: (threadId: string) => Promise<void>;
  sendUserMessage: (content: string) => Promise<void>;
  runTask: (command: string) => Promise<void>;
  cancelTask: (taskId: string) => Promise<void>;
  selectTask: (taskId: string) => Promise<void>;
  refreshGit: () => Promise<void>;
}

let listeners: UnlistenFn[] = [];

function cleanupListeners() {
  for (const unlisten of listeners) {
    unlisten();
  }
  listeners = [];
}

export const useAppStore = create<AppStore>((set, get) => ({
  projects: [],
  activeProjectId: "",
  threads: [],
  activeThreadId: "",
  messages: [],
  tasks: [],
  selectedTaskId: "",
  taskLogs: [],
  git: null,
  loading: false,
  statusText: "Ready",
  listenersReady: false,

  init: async () => {
    set({ loading: true, statusText: "Loading projects..." });
    const projects = await listProjects();

    set({
      projects,
      activeProjectId: projects[0]?.id ?? "",
      loading: false,
      statusText: "Ready",
    });

    const activeProjectId = get().activeProjectId;
    if (activeProjectId) {
      await get().selectProject(activeProjectId);
    }

    if (!get().listenersReady) {
      cleanupListeners();

      const stdoutUnlisten = await listen<TaskLogEvent>("task:stdout", async (event) => {
        const payload = event.payload;
        const activeThreadId = get().activeThreadId;
        if (payload.threadId !== activeThreadId) {
          return;
        }

        const selectedTaskId = get().selectedTaskId || payload.taskId;
        if (selectedTaskId !== payload.taskId) {
          return;
        }

        set((state) => ({
          taskLogs: [
            ...state.taskLogs,
            {
              id: `${payload.taskId}-${Date.now()}-${Math.random()}`,
              taskId: payload.taskId,
              stream: payload.stream,
              line: payload.line,
              createdAt: Date.now(),
            },
          ],
        }));
      });

      const stderrUnlisten = await listen<TaskLogEvent>("task:stderr", async (event) => {
        const payload = event.payload;
        const activeThreadId = get().activeThreadId;
        if (payload.threadId !== activeThreadId) {
          return;
        }

        const selectedTaskId = get().selectedTaskId || payload.taskId;
        if (selectedTaskId !== payload.taskId) {
          return;
        }

        set((state) => ({
          taskLogs: [
            ...state.taskLogs,
            {
              id: `${payload.taskId}-${Date.now()}-${Math.random()}`,
              taskId: payload.taskId,
              stream: payload.stream,
              line: payload.line,
              createdAt: Date.now(),
            },
          ],
        }));
      });

      const statusUnlisten = await listen<TaskStatusEvent>("task:status", async (event) => {
        const payload = event.payload;
        const activeThreadId = get().activeThreadId;
        if (payload.threadId !== activeThreadId) {
          return;
        }

        set((state) => ({
          tasks: state.tasks.map((task) =>
            task.id === payload.taskId
              ? {
                  ...task,
                  status: payload.status,
                  exitCode: payload.exitCode,
                }
              : task,
          ),
          statusText: `Task ${payload.taskId} -> ${payload.status}`,
        }));
      });

      listeners = [stdoutUnlisten, stderrUnlisten, statusUnlisten];
      set({ listenersReady: true });
    }
  },

  createProject: async (path: string, name?: string) => {
    const created = await createProject(path, name);
    const projects = await listProjects();

    set({
      projects,
      activeProjectId: created.id,
      statusText: `Project ${created.name} added`,
    });

    await get().selectProject(created.id);
  },

  selectProject: async (projectId: string) => {
    await touchProject(projectId);
    const threads = await listThreads(projectId);

    set({
      activeProjectId: projectId,
      threads,
      activeThreadId: threads[0]?.id ?? "",
      messages: [],
      tasks: [],
      selectedTaskId: "",
      taskLogs: [],
    });

    if (threads[0]?.id) {
      await get().selectThread(threads[0].id);
    }

    await get().refreshGit();
  },

  createThread: async (name: string, description?: string) => {
    const projectId = get().activeProjectId;
    if (!projectId) {
      return;
    }

    const created = await createThread(projectId, name, description);
    const threads = await listThreads(projectId);
    set({ threads, activeThreadId: created.id, statusText: `Thread ${created.name} created` });
    await get().selectThread(created.id);
  },

  selectThread: async (threadId: string) => {
    const [messages, tasks] = await Promise.all([listThreadMessages(threadId), listTasks(threadId)]);
    const selectedTaskId = tasks[0]?.id ?? "";
    const taskLogs = selectedTaskId ? await listTaskLogs(selectedTaskId) : [];

    set({
      activeThreadId: threadId,
      messages,
      tasks,
      selectedTaskId,
      taskLogs,
      statusText: "Thread loaded",
    });
  },

  sendUserMessage: async (content: string) => {
    const threadId = get().activeThreadId;
    if (!threadId || !content.trim()) {
      return;
    }

    await addThreadMessage(threadId, "user", content.trim());
    const messages = await listThreadMessages(threadId);
    set({ messages, statusText: "Message added" });
  },

  runTask: async (command: string) => {
    const threadId = get().activeThreadId;
    const project = get().projects.find((p) => p.id === get().activeProjectId);

    if (!threadId || !project || !command.trim()) {
      return;
    }

    const task = await runTask(threadId, command.trim(), project.path, "powershell");
    const tasks = await listTasks(threadId);
    set({ tasks, selectedTaskId: task.id, taskLogs: [], statusText: `Task queued: ${task.id}` });
  },

  cancelTask: async (taskId: string) => {
    await cancelTask(taskId);
    const threadId = get().activeThreadId;
    if (!threadId) return;
    const tasks = await listTasks(threadId);
    set({ tasks, statusText: `Task cancelled: ${taskId}` });
  },

  selectTask: async (taskId: string) => {
    const logs = await listTaskLogs(taskId);
    set({ selectedTaskId: taskId, taskLogs: logs });
  },

  refreshGit: async () => {
    const project = get().projects.find((p) => p.id === get().activeProjectId);
    if (!project) {
      set({ git: null });
      return;
    }

    const status = await gitStatus(project.path);
    set({ git: status });
  },
}));
