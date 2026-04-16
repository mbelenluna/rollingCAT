import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Home,
  Languages,
  Link2,
  LogOut,
  Trash2,
  Redo2,
  Upload,
  Undo2,
  UserRound,
  X,
} from 'lucide-react';
import { AUTOSAVE_DELAY, STATUS_META } from './lib/constants';
import {
  createCloudWorkspace,
  deleteWorkspace,
  ensureProfile,
  listWorkspacesByUser,
  loadProject,
  saveProject,
} from './lib/db';
import {
  exportSegmentsToWorkbook,
  parseSegmentFile,
  parseSimplePairsFile,
  parseSimplePairsFiles,
  parseSimplePairsFromGoogleSheetUrl,
} from './lib/excel';
import { buildHighlightedSource, findGlossaryMatches } from './lib/glossary';
import { createProjectFromUpload, mergeGlossaryEntries, mergeTmEntries, recomputeSegmentMatches, saveSegmentTranslation } from './lib/session';
import { findTmMatches } from './lib/tm';
import { getSessionUser, loadAppState, onAuthStateChange, requestPasswordReset, saveAppState, signInWithEmail, signOutUser, signUpWithEmail } from './lib/auth';

const ACTIVE_PROJECT_DRAFT_KEY = 'rollingcat-active-project-draft';

function classNames(...values) {
  return values.filter(Boolean).join(' ');
}

function upsertWorkspaceSummary(existingWorkspaces, nextWorkspace) {
  const remainingWorkspaces = existingWorkspaces.filter((workspace) => workspace.id !== nextWorkspace.id);
  return [nextWorkspace, ...remainingWorkspaces].sort((a, b) => b.updatedAt - a.updatedAt);
}

function buildWorkspaceSummaryFromDraft(workspace, files) {
  const totalSegments = files.reduce((sum, file) => sum + file.segments.length, 0);
  const translatedSegments = files.reduce((sum, file) => sum + file.segments.filter((segment) => segment.status === 'translated').length, 0);

  return {
    id: workspace.id,
    name: workspace.name,
    userId: workspace.userId,
    updatedAt: workspace.updatedAt,
    fileCount: files.length,
    totalSegments,
    translatedSegments,
    files: files.map((file) => ({
      id: file.id,
      workspaceId: workspace.id,
      fileName: file.fileName,
      originalFileName: file.originalFileName,
      updatedAt: file.updatedAt,
      segmentCount: file.segments.length,
      translatedCount: file.segments.filter((segment) => segment.status === 'translated').length,
      storagePath: file.storagePath ?? null,
    })),
  };
}

function getNextIndex(segments, currentIndex, direction = 1, untranslatedOnly = false) {
  if (!segments.length) {
    return -1;
  }

  const step = direction >= 0 ? 1 : -1;
  for (let index = currentIndex + step; index >= 0 && index < segments.length; index += step) {
    if (!untranslatedOnly || segments[index].status !== 'translated') {
      return index;
    }
  }

  return Math.min(Math.max(currentIndex + step, 0), segments.length - 1);
}

function loadActiveProjectDraft() {
  try {
    const raw = window.localStorage.getItem(ACTIVE_PROJECT_DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveActiveProjectDraft(project) {
  if (!project) {
    return;
  }

  try {
    window.localStorage.setItem(ACTIVE_PROJECT_DRAFT_KEY, JSON.stringify(project));
  } catch {
    // Ignore local draft persistence failures.
  }
}

function clearActiveProjectDraft() {
  try {
    window.localStorage.removeItem(ACTIVE_PROJECT_DRAFT_KEY);
  } catch {
    // Ignore local draft cleanup failures.
  }
}

function mergeProjectWithDraft(project, draft) {
  if (!project || !draft || project.id !== draft.id) {
    return project;
  }

  const draftSegments = new Map((draft.segments ?? []).map((segment) => [segment.id, segment]));

  return {
    ...project,
    currentSegmentId: draft.currentSegmentId ?? project.currentSegmentId,
    updatedAt: Math.max(project.updatedAt ?? 0, draft.updatedAt ?? 0),
    segments: project.segments.map((segment) => {
      const draftSegment = draftSegments.get(segment.id);
      return draftSegment ? { ...segment, ...draftSegment } : segment;
    }),
  };
}

function Toast({ message }) {
  if (!message) {
    return null;
  }

  return (
    <div className="fixed right-6 top-6 z-50 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 shadow-lg shadow-emerald-100/80">
      {message}
    </div>
  );
}

function GoogleSheetGlossaryDialog({ value, loading, onChange, onClose, onImport }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-6 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-[28px] border border-slate-200 bg-white p-6 shadow-2xl shadow-slate-300/30">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-800">
              <Link2 className="h-3.5 w-3.5" />
              Google Sheets Glossary
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-slate-900">Import glossary from a Google Sheets tab</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Paste the Google Sheets link for the exact tab you want to import. This works without APIs or payment if the tab is public or published to the web.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 space-y-3">
          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/.../edit#gid=123456789"
            className="min-h-[108px] w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
            spellCheck={false}
          />
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Expected format: Column A = source term, Column B = target term. The first row may be a header row.
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-2xl border border-slate-200 px-4 py-3 font-medium text-slate-700 transition hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onImport}
            className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-4 py-3 font-medium text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-sky-300"
          >
            <Link2 className="h-4 w-4" />
            {loading ? 'Importing...' : 'Import Glossary Link'}
          </button>
        </div>
      </div>
    </div>
  );
}

function HomePage({ onGoToSignIn, onGoToRegister, currentUser, onGoToDashboard }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl items-center px-6 py-10">
      <div className="grid w-full gap-8 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-[32px] border border-white/70 bg-white/80 p-10 shadow-2xl shadow-slate-300/20 backdrop-blur">
          <div className="inline-flex items-center gap-2 rounded-full bg-sky-100 px-4 py-2 text-sm font-medium text-sky-700">
            <Languages className="h-4 w-4" />
            RollingCAT
          </div>
          <h1 className="mt-6 max-w-2xl text-5xl font-semibold tracking-tight text-slate-900">
            RollingCAT is a local-first CAT workspace for translators handling UI strings and product content.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
            Sign in, keep separate project workspaces, upload bilingual Excel files, and translate with TM and glossary support directly in the browser.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            {currentUser ? (
              <button type="button" onClick={onGoToDashboard} className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-5 py-3 font-semibold text-white transition hover:bg-sky-700">
                <Home className="h-4 w-4" />
                Open Dashboard
              </button>
            ) : (
              <>
                <button type="button" onClick={onGoToRegister} className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-5 py-3 font-semibold text-white transition hover:bg-sky-700">
                  <UserRound className="h-4 w-4" />
                  Register
                </button>
                <button type="button" onClick={onGoToSignIn} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 font-semibold text-slate-800 transition hover:bg-slate-50">
                  Sign In
                </button>
              </>
            )}
          </div>
        </div>

        <div className="rounded-[32px] border border-slate-200 bg-slate-900 p-8 text-slate-50 shadow-2xl shadow-slate-400/20">
          <h2 className="text-xl font-semibold">How it works</h2>
          <div className="mt-6 space-y-4 text-sm leading-7 text-slate-300">
            <p>Accounts and projects are stored locally in this browser, so there is no backend setup required.</p>
            <p>Each user gets a project dashboard where existing jobs can be reopened and new projects can be created from Excel files.</p>
            <p>Glossaries can come from Excel files or public Google Sheets links, and TM grows as translators confirm segments.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function AuthPage({ mode, form, error, onChange, onSubmit, onBack, busy, onPasswordReset }) {
  const isRegister = mode === 'register';

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl items-center justify-center px-6 py-10">
      <div className="w-full max-w-xl rounded-[32px] border border-white/70 bg-white/85 p-8 shadow-2xl shadow-slate-300/20 backdrop-blur">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </button>
        <h1 className="mt-6 text-3xl font-semibold text-slate-900">{isRegister ? 'Create your local workspace account' : 'Sign in to your workspace'}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {isRegister
            ? 'Your account lives only in this browser. It keeps your projects separated and easy to reopen.'
            : 'Sign in with the local account previously created in this browser.'}
        </p>

        <form
          className="mt-6 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          {isRegister ? (
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Name</span>
              <input
                value={form.name}
                onChange={(event) => onChange('name', event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
                placeholder="Translator name"
              />
            </label>
          ) : null}
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Email</span>
            <input
              type="email"
              value={form.email}
              onChange={(event) => onChange('email', event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
              placeholder="name@example.com"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Password</span>
            <input
              type="password"
              value={form.password}
              onChange={(event) => onChange('password', event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
              placeholder="Password"
            />
          </label>

          {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-2xl bg-sky-600 px-4 py-3 font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-sky-300"
          >
            {busy ? 'Working...' : isRegister ? 'Register' : 'Sign In'}
          </button>
          {!isRegister ? (
            <button
              type="button"
              onClick={onPasswordReset}
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Send Password Reset Email
            </button>
          ) : null}
        </form>
      </div>
    </div>
  );
}

function Dashboard({ user, projects, onOpenProject, onCreateProject, onSignOut, onDeleteProject }) {
  const displayName = user.user_metadata?.full_name || user.user_metadata?.name || user.email;

  return (
    <div className="mx-auto min-h-screen max-w-7xl px-6 py-8">
      <div className="flex flex-col gap-4 rounded-[32px] border border-white/70 bg-white/85 p-6 shadow-2xl shadow-slate-300/20 backdrop-blur lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-sm font-medium uppercase tracking-[0.24em] text-slate-400">Workspace</div>
          <h1 className="mt-2 text-3xl font-semibold text-slate-900">Welcome back, {displayName}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">Open an existing CAT workspace or create a new one by uploading one or more Excel files.</p>
        </div>
        <div className="flex flex-wrap gap-3">
            <button type="button" onClick={onCreateProject} className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-4 py-3 font-medium text-white transition hover:bg-sky-700">
              <Upload className="h-4 w-4" />
              New Workspace
            </button>
          <button type="button" onClick={onSignOut} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 font-medium text-slate-700 transition hover:bg-slate-50">
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {projects.length ? (
          projects.map((project) => {
            const translatedCount = project.translatedSegments ?? 0;
            const total = project.totalSegments ?? 0;
            const percent = total > 0 ? Math.round((translatedCount / total) * 100) : 0;

            return (
              <div
                key={project.id}
                className="rounded-[28px] border border-slate-200 bg-white p-5 text-left shadow-lg shadow-slate-200/40 transition hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-sky-100"
              >
                <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold text-slate-900">{project.name}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400">{project.fileCount} file{project.fileCount === 1 ? '' : 's'}</div>
                    </div>
                  <div className="flex items-center gap-2">
                    <div className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">{percent}%</div>
                    <button
                      type="button"
                      onClick={() => onDeleteProject(project)}
                      className="inline-flex items-center justify-center rounded-full border border-rose-200 bg-rose-50 p-2 text-rose-600 transition hover:bg-rose-100"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                  <div className="mt-3 text-sm text-slate-600">
                    {translatedCount} / {total} segments translated across this workspace
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-cyan-400" style={{ width: `${percent}%` }} />
                  </div>
                  <div className="mt-4 space-y-2">
                    {project.files.map((file) => {
                      const filePercent = file.segmentCount ? Math.round((file.translatedCount / file.segmentCount) * 100) : 0;
                      return (
                        <button
                          key={file.id}
                          type="button"
                          onClick={() => onOpenProject(file.id)}
                          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition hover:border-sky-200 hover:bg-sky-50"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-slate-800">{file.fileName}</div>
                              <div className="mt-1 text-xs text-slate-500">{file.originalFileName}</div>
                            </div>
                            <div className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-sky-700">{filePercent}%</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="rounded-[28px] border border-dashed border-slate-300 bg-white/80 p-8 text-sm leading-7 text-slate-600 md:col-span-2 xl:col-span-3">
            No workspaces yet. Upload one or more Excel files to create your first CAT project workspace.
            </div>
          )}
      </div>
    </div>
  );
}

function App() {
  const [screen, setScreen] = useState('home');
  const [loading, setLoading] = useState(true);
  const [busyAuth, setBusyAuth] = useState(false);
  const [authError, setAuthError] = useState('');
  const [registerForm, setRegisterForm] = useState({ name: '', email: '', password: '' });
  const [signInForm, setSignInForm] = useState({ email: '', password: '' });
  const [currentUser, setCurrentUser] = useState(null);
  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [activeTarget, setActiveTarget] = useState('');
  const [toastMessage, setToastMessage] = useState('');
  const [savedIndicator, setSavedIndicator] = useState('Idle');
  const [isGlossaryLinkDialogOpen, setIsGlossaryLinkDialogOpen] = useState(false);
  const [glossarySheetUrl, setGlossarySheetUrl] = useState('');
  const [isImportingGlossaryLink, setIsImportingGlossaryLink] = useState(false);
  const [historyState, setHistoryState] = useState({});
  const textareaRef = useRef(null);
  const createProjectInputRef = useRef(null);
  const segmentRefs = useRef(new Map());
  const autosaveTimeoutRef = useRef(null);
  const activeProjectRef = useRef(null);
  const currentUserRef = useRef(null);
  const screenRef = useRef('home');

  async function flushProjectSave(project, options = {}) {
    const { remote = true } = options;
    if (!project) {
      return;
    }

    saveActiveProjectDraft(project);

    if (!remote || !currentUserRef.current || (project.storagePath && !project.segments.length)) {
      return;
    }

    await saveProject(project);
  }

  async function persistEditorBeforeNavigation(options = {}) {
    const { remote = true } = options;
    const project = activeProjectRef.current;

    if (!project || screenRef.current !== 'editor') {
      return;
    }

    if (autosaveTimeoutRef.current) {
      window.clearTimeout(autosaveTimeoutRef.current);
      autosaveTimeoutRef.current = null;
    }

    setSavedIndicator('Saving...');
    await flushProjectSave(project, { remote });
    setSavedIndicator('Saved');
  }

  useEffect(() => {
    activeProjectRef.current = activeProject;
  }, [activeProject]);

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  useEffect(() => {
    let mounted = true;

    async function boot() {
      const appState = loadAppState();
      const user = await getSessionUser();
      if (!mounted) {
        return;
      }

      if (user) {
        await ensureProfile(user);
        const userProjects = await listWorkspacesByUser();
        if (!mounted) {
          return;
        }

        setCurrentUser(user);
        setProjects(userProjects);
        setScreen('dashboard');

        if (appState.lastOpenedProjectId) {
          try {
            const project = await loadProject(appState.lastOpenedProjectId);
            const draft = loadActiveProjectDraft();
            if (mounted) {
              setActiveProject(mergeProjectWithDraft(project, draft));
              setScreen('editor');
            }
          } catch {
            const draft = loadActiveProjectDraft();
            if (mounted && draft?.id === appState.lastOpenedProjectId) {
              setActiveProject(draft);
              setScreen('editor');
            }
          }
        }
      }

      if (mounted) {
        setLoading(false);
      }
    }

    boot();

    const {
      data: { subscription },
    } = onAuthStateChange(async (event, user) => {
      if (!mounted) {
        return;
      }

      if (!user) {
        if (event !== 'SIGNED_OUT') {
          const recoveredUser = await getSessionUser();
          if (recoveredUser) {
            const userProjects = await listWorkspacesByUser();
            if (!mounted) {
              return;
            }

            setCurrentUser(recoveredUser);
            setProjects(userProjects);
            return;
          }
        }

        setCurrentUser(null);
        setProjects([]);
        clearActiveProjectDraft();
        setActiveProject(null);
        setScreen('home');
        return;
      }

      await ensureProfile(user);
        const userProjects = await listWorkspacesByUser();
      if (!mounted) {
        return;
      }

      setCurrentUser(user);
      setProjects(userProjects);
      if (screenRef.current !== 'editor') {
        setScreen('dashboard');
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!toastMessage) {
      return undefined;
    }

    const timeout = window.setTimeout(() => setToastMessage(''), 2400);
    return () => window.clearTimeout(timeout);
  }, [toastMessage]);

  const activeIndex = useMemo(() => {
    if (!activeProject?.segments?.length) {
      return -1;
    }

    return activeProject.segments.findIndex((segment) => segment.id === activeProject.currentSegmentId);
  }, [activeProject]);

  const activeSegment = activeIndex >= 0 ? activeProject?.segments?.[activeIndex] : null;

  const glossaryMatches = useMemo(
    () => (activeSegment ? findGlossaryMatches(activeSegment.source, activeProject?.glossaryEntries ?? []) : []),
    [activeSegment, activeProject?.glossaryEntries],
  );

  const highlightedSource = useMemo(
    () => buildHighlightedSource(activeSegment?.source ?? '', activeProject?.glossaryEntries ?? []),
    [activeSegment, activeProject?.glossaryEntries],
  );

  const tmMatches = useMemo(
    () => (activeSegment ? findTmMatches(activeSegment.source, activeProject?.tmEntries ?? []) : []),
    [activeSegment, activeProject?.tmEntries],
  );

  const translatedCount = useMemo(
    () => activeProject?.segments?.filter((segment) => segment.status === 'translated').length ?? 0,
    [activeProject],
  );

  const progressPercent = activeProject?.segments?.length ? Math.round((translatedCount / activeProject.segments.length) * 100) : 0;
  const canUndo = !!(activeSegment && historyState[activeSegment.id]?.past?.length);
  const canRedo = !!(activeSegment && historyState[activeSegment.id]?.future?.length);

  useEffect(() => {
    setActiveTarget(activeSegment?.target ?? '');
  }, [activeSegment?.id, activeSegment?.target]);

  useEffect(() => {
    if (!activeSegment) {
      return;
    }

    const element = segmentRefs.current.get(activeSegment.id);
    element?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeSegment?.id]);

  useEffect(() => {
    if (!activeProject || screen !== 'editor') {
      return undefined;
    }

    saveActiveProjectDraft(activeProject);

    if (activeProject.storagePath && !activeProject.segments.length) {
      setSavedIndicator('Waiting for segments...');
      return undefined;
    }

    if (autosaveTimeoutRef.current) {
      window.clearTimeout(autosaveTimeoutRef.current);
    }

    autosaveTimeoutRef.current = window.setTimeout(async () => {
      setSavedIndicator('Saving...');
      await flushProjectSave(activeProject);
      if (currentUser) {
        const refreshedProjects = await listWorkspacesByUser();
        setProjects(refreshedProjects);
      }
      setSavedIndicator('Saved');
    }, AUTOSAVE_DELAY);

    return () => {
      if (autosaveTimeoutRef.current) {
        window.clearTimeout(autosaveTimeoutRef.current);
      }
    };
  }, [activeProject, currentUser, screen]);

  useEffect(() => {
    async function persistBeforeBackground() {
      const project = activeProjectRef.current;
      if (!project || screenRef.current !== 'editor') {
        return;
      }

      if (autosaveTimeoutRef.current) {
        window.clearTimeout(autosaveTimeoutRef.current);
        autosaveTimeoutRef.current = null;
      }

      setSavedIndicator('Saving...');
      await flushProjectSave(project, { remote: document.visibilityState !== 'hidden' });
      setSavedIndicator('Saved');
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        void persistBeforeBackground();
      }
    }

    function handlePageHide() {
      const project = activeProjectRef.current;
      if (project && screenRef.current === 'editor') {
        saveActiveProjectDraft(project);
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, []);

  function updateProjectState(updater) {
    setActiveProject((current) => {
      if (!current) {
        return current;
      }

      const next = typeof updater === 'function' ? updater(current) : updater;
      if (!next) {
        return next;
      }

      return {
        ...next,
        updatedAt: Date.now(),
      };
    });
  }

  function pushHistory(segmentId, previousValue) {
    setHistoryState((current) => {
      const existing = current[segmentId] ?? { past: [], future: [] };
      return {
        ...current,
        [segmentId]: {
          past: [...existing.past, previousValue].slice(-100),
          future: [],
        },
      };
    });
  }

  function applyEditorValue(nextValue, options = {}) {
    if (!activeProject || !activeSegment) {
      return;
    }

    if (!options.skipHistory && nextValue !== activeTarget) {
      pushHistory(activeSegment.id, activeTarget);
    }

    setActiveTarget(nextValue);
    updateProjectState((currentProject) => ({
      ...currentProject,
      segments: currentProject.segments.map((segment) => (segment.id === activeSegment.id ? { ...segment, target: nextValue } : segment)),
    }));
  }

  function handleUndo() {
    if (!activeSegment) {
      return;
    }

    setHistoryState((current) => {
      const segmentHistory = current[activeSegment.id] ?? { past: [], future: [] };
      if (!segmentHistory.past.length) {
        return current;
      }

      const previousValue = segmentHistory.past[segmentHistory.past.length - 1];
      const newPast = segmentHistory.past.slice(0, -1);
      const currentValue = activeTarget;
      setActiveTarget(previousValue);
      updateProjectState((project) => ({
        ...project,
        segments: project.segments.map((segment) => (segment.id === activeSegment.id ? { ...segment, target: previousValue } : segment)),
      }));

      return {
        ...current,
        [activeSegment.id]: {
          past: newPast,
          future: [currentValue, ...segmentHistory.future].slice(0, 100),
        },
      };
    });
  }

  function handleRedo() {
    if (!activeSegment) {
      return;
    }

    setHistoryState((current) => {
      const segmentHistory = current[activeSegment.id] ?? { past: [], future: [] };
      if (!segmentHistory.future.length) {
        return current;
      }

      const [nextValue, ...remainingFuture] = segmentHistory.future;
      const currentValue = activeTarget;
      setActiveTarget(nextValue);
      updateProjectState((project) => ({
        ...project,
        segments: project.segments.map((segment) => (segment.id === activeSegment.id ? { ...segment, target: nextValue } : segment)),
      }));

      return {
        ...current,
        [activeSegment.id]: {
          past: [...segmentHistory.past, currentValue].slice(-100),
          future: remainingFuture,
        },
      };
    });
  }

  function moveSelection(direction) {
    if (!activeProject?.segments?.length) {
      return;
    }

    const nextIndex = getNextIndex(activeProject.segments, activeIndex, direction, false);
    const nextSegment = activeProject.segments[nextIndex];
    if (!nextSegment) {
      return;
    }

    updateProjectState({
      ...activeProject,
      currentSegmentId: nextSegment.id,
    });
  }

  useEffect(() => {
    if (screen !== 'editor' || !activeProject) {
      return undefined;
    }

    function handleGlobalShortcuts(event) {
      const isTyping = document.activeElement === textareaRef.current;
      const modifier = event.ctrlKey || event.metaKey;

      if (modifier && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        handleUndo();
      }

      if ((modifier && event.key.toLowerCase() === 'y') || (modifier && event.shiftKey && event.key.toLowerCase() === 'z')) {
        event.preventDefault();
        handleRedo();
      }

      if (event.altKey && event.key === 'ArrowDown') {
        event.preventDefault();
        moveSelection(1);
      }

      if (event.altKey && event.key === 'ArrowUp') {
        event.preventDefault();
        moveSelection(-1);
      }

      if (event.altKey && ['1', '2', '3'].includes(event.key)) {
        const match = tmMatches[Number(event.key) - 1];
        if (match) {
          event.preventDefault();
          applyEditorValue(match.target);
          textareaRef.current?.focus();
        }
      }

      if (event.key === 'Escape' && isTyping) {
        event.preventDefault();
        applyEditorValue('');
      }

      if (!isTyping && event.key === 'ArrowDown') {
        event.preventDefault();
        moveSelection(1);
      }

      if (!isTyping && event.key === 'ArrowUp') {
        event.preventDefault();
        moveSelection(-1);
      }
    }

    window.addEventListener('keydown', handleGlobalShortcuts);
    return () => window.removeEventListener('keydown', handleGlobalShortcuts);
  }, [screen, activeProject, activeTarget, tmMatches, activeIndex, historyState]);

  async function refreshProjects() {
    const userProjects = await listWorkspacesByUser();
    setProjects(userProjects);
  }

  async function handleRegister() {
    setBusyAuth(true);
    setAuthError('');

    try {
      if (!registerForm.name.trim() || !registerForm.email.trim() || !registerForm.password.trim()) {
        throw new Error('Please complete all registration fields.');
      }

      const { user, session } = await signUpWithEmail({
        email: registerForm.email.trim(),
        password: registerForm.password,
        fullName: registerForm.name.trim(),
      });

      if (!user) {
        throw new Error('Sign-up did not return a user.');
      }

      if (session?.user) {
        await ensureProfile(session.user);
      }
      saveAppState({ lastOpenedProjectId: null });
      setCurrentUser(session?.user ?? null);
      setProjects([]);
      setRegisterForm({ name: '', email: '', password: '' });
      setScreen(session ? 'dashboard' : 'signin');
      setToastMessage(session ? 'Account created' : 'Account created. Check your email to confirm your sign-in.');
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Could not create account');
    } finally {
      setBusyAuth(false);
    }
  }

  async function handleSignIn() {
    setBusyAuth(true);
    setAuthError('');

    try {
      if (!signInForm.email.trim() || !signInForm.password.trim()) {
        throw new Error('Please enter your email and password.');
      }

      const { user } = await signInWithEmail({
        email: signInForm.email.trim(),
        password: signInForm.password,
      });

      if (!user) {
        throw new Error('Could not load your account.');
      }

      await ensureProfile(user);
      saveAppState({ lastOpenedProjectId: null });
      setCurrentUser(user);
      await refreshProjects();
      setSignInForm({ email: '', password: '' });
      setScreen('dashboard');
      setToastMessage('Signed in');
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Could not sign in');
    } finally {
      setBusyAuth(false);
    }
  }

  async function handlePasswordReset() {
    try {
      if (!signInForm.email.trim()) {
        throw new Error('Enter your email first, then request a reset link.');
      }

      await requestPasswordReset(signInForm.email.trim());
      setToastMessage('Password reset email sent');
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Could not send password reset email');
    }
  }

  async function handleSignOut() {
    await persistEditorBeforeNavigation();
    await signOutUser();
    saveAppState({ lastOpenedProjectId: null });
    clearActiveProjectDraft();
    setCurrentUser(null);
    setProjects([]);
    setActiveProject(null);
    setHistoryState({});
    setScreen('home');
  }

  async function handleProjectUpload(files) {
    if (!files?.length || !currentUser) {
      return;
    }

    const uploadedFiles = Array.from(files);
    const parsedFiles = await Promise.all(uploadedFiles.map((file) => parseSegmentFile(file)));
    const defaultWorkspaceName =
      uploadedFiles.length === 1
        ? parsedFiles[0].projectName
        : `${parsedFiles[0].projectName} Workspace`;
    const workspaceName = window.prompt('Workspace name', defaultWorkspaceName)?.trim() || defaultWorkspaceName;

    const workspace = {
      id: crypto.randomUUID(),
      userId: currentUser.id,
      name: workspaceName,
      glossaryEntries: [],
      tmEntries: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const draftFiles = parsedFiles.map((uploadResult) => {
      const draftProject = createProjectFromUpload(uploadResult, currentUser.id);
      return {
        ...draftProject,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        fileName: uploadResult.projectName,
        projectName: workspace.name,
        tmEntries: [],
        glossaryEntries: [],
      };
    });

    const draftWorkspaceSummary = buildWorkspaceSummaryFromDraft(workspace, draftFiles);
    setProjects((current) => upsertWorkspaceSummary(current, draftWorkspaceSummary));

    const originalsByFileId = Object.fromEntries(draftFiles.map((draftFile, index) => [draftFile.id, uploadedFiles[index]]));
    const workspaceSummary = await createCloudWorkspace({ workspace, files: draftFiles, originalsByFileId });
    setProjects((current) => upsertWorkspaceSummary(current, workspaceSummary));
    if (workspaceSummary.files[0]) {
      const project = await loadProject(workspaceSummary.files[0].id);
      setActiveProject(project);
      saveActiveProjectDraft(project);
      saveAppState({ lastOpenedProjectId: project.id });
      setScreen('editor');
    }
    setHistoryState({});
    setToastMessage(uploadedFiles.length === 1 ? 'Workspace created' : `${uploadedFiles.length} files added to new workspace`);
  }

  async function handleOpenProject(projectId) {
    if (!currentUser) {
      return;
    }

    await persistEditorBeforeNavigation();
    const project = await loadProject(projectId);
    if (!project) {
      return;
    }

    setActiveProject(project);
    saveActiveProjectDraft(project);
    setHistoryState({});
    setScreen('editor');
    saveAppState({ lastOpenedProjectId: project.id });
  }

  async function handleDeleteProject(projectSummary) {
    if (!window.confirm(`Delete workspace "${projectSummary.name}" and all of its files permanently from your account?`)) {
      return;
    }

    try {
      await deleteWorkspace(projectSummary.id, projectSummary.files);
      if (activeProject?.workspaceId === projectSummary.id) {
        clearActiveProjectDraft();
        setActiveProject(null);
      }
      await refreshProjects();
      const appState = loadAppState();
      if (appState.lastOpenedProjectId === projectSummary.id) {
        saveAppState({ lastOpenedProjectId: null });
      }
      setToastMessage('Project deleted');
    } catch (error) {
      setToastMessage(error instanceof Error ? error.message : 'Could not delete project');
    }
  }

  async function handleAuxiliaryUpload(filesOrFile, kind) {
    if (!filesOrFile || !activeProject) {
      return;
    }

    const files = Array.isArray(filesOrFile) ? filesOrFile : [filesOrFile];
    const entries = kind === 'glossary' ? await parseSimplePairsFiles(files) : await parseSimplePairsFile(files[0]);
    const nextProject = kind === 'glossary' ? mergeGlossaryEntries(activeProject, entries) : mergeTmEntries(activeProject, entries);

    setActiveProject(nextProject);
    setToastMessage(
      kind === 'glossary'
        ? `${entries.length} glossary entr${entries.length === 1 ? 'y' : 'ies'} loaded from ${files.length} file${files.length === 1 ? '' : 's'}`
        : 'Translation memory merged',
    );
  }

  async function handleGlossaryLinkImport() {
    if (!activeProject || !glossarySheetUrl.trim()) {
      return;
    }

    try {
      setIsImportingGlossaryLink(true);
      const entries = await parseSimplePairsFromGoogleSheetUrl(glossarySheetUrl.trim());
      setActiveProject(mergeGlossaryEntries(activeProject, entries));
      setIsGlossaryLinkDialogOpen(false);
      setGlossarySheetUrl('');
      setToastMessage(`${entries.length} glossary entr${entries.length === 1 ? 'y' : 'ies'} loaded from Google Sheets`);
    } catch (error) {
      setToastMessage(error instanceof Error ? error.message : 'Could not import that Google Sheet');
    } finally {
      setIsImportingGlossaryLink(false);
    }
  }

  function saveCurrentSegment({ advance = true } = {}) {
    if (!activeProject || !activeSegment) {
      return;
    }

    const savedProject = recomputeSegmentMatches(saveSegmentTranslation(activeProject, activeSegment.id, activeTarget));
    const currentIndex = savedProject.segments.findIndex((segment) => segment.id === activeSegment.id);
    const nextIndex = advance ? getNextIndex(savedProject.segments, currentIndex, 1, true) : currentIndex;
    const nextSegment = savedProject.segments[nextIndex];
    const updatedProject = {
      ...savedProject,
      currentSegmentId: nextSegment?.id ?? savedProject.currentSegmentId,
    };

    setActiveProject(updatedProject);
    saveActiveProjectDraft(updatedProject);
    setToastMessage('Segment saved');
    setSavedIndicator('Saved');
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-slate-500">Loading CAT workspace...</div>;
  }

  if (screen === 'home') {
    return <HomePage currentUser={currentUser} onGoToSignIn={() => setScreen('signin')} onGoToRegister={() => setScreen('register')} onGoToDashboard={() => setScreen('dashboard')} />;
  }

  if (screen === 'register') {
    return (
      <AuthPage
        mode="register"
        form={registerForm}
        error={authError}
        busy={busyAuth}
        onBack={() => setScreen('home')}
        onChange={(field, value) => setRegisterForm((current) => ({ ...current, [field]: value }))}
        onSubmit={handleRegister}
      />
    );
  }

  if (screen === 'signin') {
    return (
      <AuthPage
        mode="signin"
        form={signInForm}
        error={authError}
        busy={busyAuth}
        onBack={() => setScreen('home')}
        onChange={(field, value) => setSignInForm((current) => ({ ...current, [field]: value }))}
        onSubmit={handleSignIn}
        onPasswordReset={handlePasswordReset}
      />
    );
  }

  if (screen === 'dashboard' && currentUser) {
    return (
      <>
        <Toast message={toastMessage} />
        <Dashboard
          user={currentUser}
          projects={projects}
          onOpenProject={handleOpenProject}
          onCreateProject={() => createProjectInputRef.current?.click()}
          onSignOut={handleSignOut}
          onDeleteProject={handleDeleteProject}
        />
        <input
          ref={createProjectInputRef}
          type="file"
          accept=".xlsx,.xls"
          multiple
          className="hidden"
          onChange={(event) => {
            handleProjectUpload(event.target.files);
            event.target.value = '';
          }}
        />
      </>
    );
  }

  if (!activeProject || !currentUser) {
    return null;
  }

  return (
    <div className="min-h-screen p-4 lg:p-6">
      <Toast message={toastMessage} />
      {isGlossaryLinkDialogOpen ? (
        <GoogleSheetGlossaryDialog
          value={glossarySheetUrl}
          loading={isImportingGlossaryLink}
          onChange={setGlossarySheetUrl}
          onClose={() => {
            if (!isImportingGlossaryLink) {
              setIsGlossaryLinkDialogOpen(false);
            }
          }}
          onImport={handleGlossaryLinkImport}
        />
      ) : null}

      <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
        <header className="rounded-[28px] border border-white/70 bg-white/88 px-6 py-5 shadow-lg shadow-slate-300/20 backdrop-blur">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-medium uppercase tracking-[0.24em] text-slate-400">Project</div>
                <div className="mt-2 truncate text-2xl font-semibold text-slate-900">{activeProject.workspaceName}</div>
                <div className="mt-2 truncate text-sm text-slate-500">{activeProject.fileName}</div>
              </div>

              <div className="w-full max-w-sm rounded-3xl border border-slate-200 bg-slate-50/90 px-5 py-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Progress</div>
                    <div className="mt-1 text-sm font-medium text-slate-700">
                      {translatedCount} / {activeProject.segments.length} segments translated
                    </div>
                  </div>
                  <div className="text-2xl font-semibold text-slate-900">{progressPercent}%</div>
                </div>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-cyan-400 transition-all" style={{ width: `${progressPercent}%` }} />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-slate-200/80 pt-4">
              <button
                type="button"
                onClick={async () => {
                  await persistEditorBeforeNavigation();
                  setScreen('home');
                }}
                className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                <Home className="h-4 w-4" />
                Home
              </button>
              <button
                type="button"
                onClick={async () => {
                  await persistEditorBeforeNavigation();
                  await refreshProjects();
                  setScreen('dashboard');
                }}
                className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                <ArrowLeft className="h-4 w-4" />
                Projects
              </button>
              <button
                type="button"
                onClick={handleUndo}
                disabled={!canUndo}
                className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Undo2 className="h-4 w-4" />
                Undo
              </button>
              <button
                type="button"
                onClick={handleRedo}
                disabled={!canRedo}
                className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Redo2 className="h-4 w-4" />
                Redo
              </button>
              <div className="hidden h-8 w-px bg-slate-200 xl:block" />
              <label className="inline-flex h-11 cursor-pointer items-center gap-2 whitespace-nowrap rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                <Upload className="h-4 w-4" />
                Upload Glossaries
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    handleAuxiliaryUpload(Array.from(event.target.files ?? []), 'glossary');
                    event.target.value = '';
                  }}
                />
              </label>
              <button type="button" onClick={() => setIsGlossaryLinkDialogOpen(true)} className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-2xl border border-amber-200 bg-amber-50 px-4 text-sm font-medium text-amber-800 transition hover:bg-amber-100">
                <Link2 className="h-4 w-4" />
                Google Sheets Glossary
              </button>
              <label className="inline-flex h-11 cursor-pointer items-center gap-2 whitespace-nowrap rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                <Upload className="h-4 w-4" />
                Upload TM
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(event) => {
                    handleAuxiliaryUpload(event.target.files?.[0], 'tm');
                    event.target.value = '';
                  }}
                />
              </label>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() =>
                  exportSegmentsToWorkbook({
                    header: activeProject.header,
                    segments: activeProject.segments,
                    fileName: activeProject.originalFileName || `${activeProject.projectName}.xlsx`,
                  })
                }
                className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-2xl bg-slate-900 px-4 text-sm font-medium text-white transition hover:bg-slate-800"
              >
                <FileSpreadsheet className="h-4 w-4" />
                Export File
              </button>
            </div>
          </div>
        </header>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(420px,0.95fr)]">
          <section className="rounded-[28px] border border-white/70 bg-white/85 shadow-lg shadow-slate-300/20 backdrop-blur">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Segments</h2>
                <p className="text-sm text-slate-500">Scroll, scan statuses, and jump between strings quickly.</p>
              </div>
              <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{savedIndicator}</div>
            </div>

            <div className="scrollbar-thin max-h-[calc(100vh-220px)] overflow-y-auto p-3">
              <div className="space-y-2">
                {activeProject.segments.map((segment) => (
                  <button
                    key={segment.id}
                    type="button"
                    ref={(node) => {
                      if (node) {
                        segmentRefs.current.set(segment.id, node);
                      } else {
                        segmentRefs.current.delete(segment.id);
                      }
                    }}
                    onClick={() => updateProjectState({ ...activeProject, currentSegmentId: segment.id })}
                    className={classNames(
                      'w-full rounded-2xl border px-4 py-4 text-left transition',
                      segment.id === activeSegment?.id ? 'border-sky-300 bg-sky-50 shadow-md shadow-sky-100/70' : 'border-slate-200 bg-slate-50/85 hover:border-slate-300 hover:bg-white',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Segment {segment.number}</div>
                        <div className="mt-2 line-clamp-2 text-sm font-medium leading-6 text-slate-800">{segment.source}</div>
                        <div className="mt-2 line-clamp-2 text-sm leading-6 text-slate-500">{segment.target || 'No translation yet'}</div>
                      </div>
                      <div className={classNames('shrink-0 rounded-full px-2.5 py-1 text-xs font-medium', STATUS_META[segment.status].className)}>
                        {STATUS_META[segment.status].label}
                        {segment.status === 'fuzzy' && segment.tmMatchPercent ? ` ${segment.tmMatchPercent}%` : ''}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-[28px] border border-white/70 bg-white/90 p-5 shadow-lg shadow-slate-300/20 backdrop-blur">
            {activeSegment ? (
              <div className="editor-panel-grid">
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Source</div>
                    <div className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-500">Segment {activeSegment.number}</div>
                  </div>
                  <div className="max-h-40 overflow-y-auto text-[15px] leading-7 text-slate-800">
                    {highlightedSource.map((part, index) => (
                      <span
                        key={`${part.text}-${index}`}
                        className={part.matched ? 'rounded bg-amber-100 px-0.5 font-semibold text-amber-900 underline decoration-amber-500 decoration-2 underline-offset-3' : ''}
                      >
                        {part.text}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Target</div>
                    <div className="text-xs text-slate-500">Enter saves and advances. Shift+Enter adds a line break.</div>
                  </div>
                  <textarea
                    ref={textareaRef}
                    value={activeTarget}
                    onChange={(event) => applyEditorValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        saveCurrentSegment({ advance: true });
                      }
                    }}
                    className="min-h-[120px] max-h-[240px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-[15px] leading-7 text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
                    placeholder="Type the translation here..."
                    spellCheck={false}
                  />
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="rounded-3xl border border-slate-200 bg-white p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
                      <Languages className="h-4 w-4" />
                      Glossary Matches
                    </div>
                    <div className="space-y-3">
                      {glossaryMatches.length ? (
                        glossaryMatches.map((entry) => (
                          <button
                            key={`${entry.source}-${entry.target}`}
                            type="button"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(entry.target);
                                setToastMessage(`Copied "${entry.target}"`);
                              } catch {
                                applyEditorValue(`${activeTarget}${activeTarget ? ' ' : ''}${entry.target}`);
                              }
                              textareaRef.current?.focus();
                            }}
                            className="w-full rounded-2xl border border-amber-200 bg-amber-50 p-3 text-left transition hover:bg-amber-100"
                          >
                            <div className="text-sm font-semibold text-amber-900">{entry.source}</div>
                            <div className="mt-1 text-sm text-amber-700">{entry.target}</div>
                          </button>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">No glossary hits in this source string yet.</div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-3xl border border-slate-200 bg-white p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
                      <Check className="h-4 w-4" />
                      TM Matches
                    </div>
                    <div className="space-y-3">
                      {tmMatches.length ? (
                        tmMatches.map((entry, index) => (
                          <div key={`${entry.source}-${entry.target}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-700">{entry.score}%</div>
                              <button
                                type="button"
                                onClick={() => {
                                  applyEditorValue(entry.target);
                                  textareaRef.current?.focus();
                                }}
                                className="rounded-full border border-sky-200 bg-white px-3 py-1 text-xs font-semibold text-sky-700 transition hover:bg-sky-50"
                              >
                                Use this {index < 3 ? `(Alt+${index + 1})` : ''}
                              </button>
                            </div>
                            <div className="mt-3 text-sm font-medium leading-6 text-slate-700">{entry.source}</div>
                            <div className="mt-2 text-sm leading-6 text-slate-500">{entry.target}</div>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">No strong TM suggestions for this segment yet.</div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-auto flex items-center justify-between rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="inline-flex items-center gap-2 text-sm text-slate-500">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    Ctrl+Z undo, Ctrl+Y redo, Escape clears, Alt+Up and Alt+Down move between segments.
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => moveSelection(-1)}
                      className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 font-medium text-slate-700 transition hover:bg-slate-100"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSelection(1)}
                      className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-4 py-2.5 font-medium text-white transition hover:bg-sky-700"
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

export default App;
