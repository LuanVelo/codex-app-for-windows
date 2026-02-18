# Codex Windows - Implementation Plan

## 1) Roadmap

### MVP (Phase 1)
- [ ] Project management (create/list/open/touch)
- [ ] Thread management per project
- [ ] Local persistence (JSON file in app data)
- [ ] Task queue with configurable parallel limit
- [ ] Command execution (PowerShell/cmd) with real-time stdout/stderr events
- [ ] Task cancel
- [ ] Git basic status + modified files list
- [ ] Two-column UI (sidebar + main chat/activity)

### Phase 2
- [ ] Git worktree per thread
- [ ] Diff viewer by file + full patch
- [ ] Skills CRUD + templates
- [ ] Settings panel (default workspace, shell, concurrency, theme)

## 2) Recommended folder structure

```text
src/apps/desktop/
├── src/
│   ├── app/
│   │   ├── routes/
│   │   ├── layout/
│   │   └── providers/
│   ├── components/
│   │   └── ui/                # shadcn/ui
│   ├── features/
│   │   ├── projects/
│   │   ├── threads/
│   │   ├── tasks/
│   │   ├── git/
│   │   └── settings/
│   ├── modules/
│   │   ├── auth/
│   │   └── workspace/
│   ├── state/
│   │   └── app-store.ts       # zustand
│   ├── lib/
│   └── main.tsx
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs             # Tauri commands + queue + streaming
│   │   ├── executor.rs         # future split
│   │   ├── git.rs              # future split
│   │   └── store.rs            # future split
│   └── tauri.conf.json
└── package.json
```

## 3) Initial commands

```bash
# bootstrap (already done in this repo)
npm create tauri-app@latest -- src/apps/desktop -m npm -t react-ts --identifier com.velodigital.codexwindows --tauri-version 2 -y

# frontend deps
cd src/apps/desktop
npm install
npm install tailwindcss @tailwindcss/vite class-variance-authority clsx tailwind-merge lucide-react @radix-ui/react-dialog
npm install zustand react-router-dom

# run
npm run tauri dev

# portable build
npm run tauri build -- --no-bundle
```
