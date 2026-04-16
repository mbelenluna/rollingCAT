import { supabase } from './supabase';
import { createSessionFromUpload } from './session';
import { parseSegmentBlob } from './excel';

function workspaceToRow(workspace) {
  return {
    id: workspace.id,
    user_id: workspace.userId,
    name: workspace.name,
    glossary_entries: workspace.glossaryEntries ?? [],
    tm_entries: workspace.tmEntries ?? [],
    updated_at: new Date(workspace.updatedAt ?? Date.now()).toISOString(),
  };
}

function fileToProjectRow(file) {
  return {
    id: file.id,
    user_id: file.userId,
    workspace_id: file.workspaceId,
    name: file.fileName,
    original_file_name: file.originalFileName,
    header: file.header,
    glossary_entries: [],
    tm_entries: [],
    current_segment_id: file.currentSegmentId,
    segment_count: file.segments.length,
    translated_count: file.segments.filter((segment) => segment.status === 'translated').length,
    storage_path: file.storagePath ?? null,
    updated_at: new Date(file.updatedAt ?? Date.now()).toISOString(),
  };
}

function segmentToRow(fileId, segment) {
  return {
    id: segment.id,
    project_id: fileId,
    segment_number: segment.number,
    source_text: segment.source,
    target_text: segment.target ?? '',
    status: segment.status,
    tm_match_percent: segment.tmMatchPercent ?? null,
    updated_at: new Date().toISOString(),
  };
}

function buildWorkspaceSummary(workspaceRow, projectRows) {
  const totalSegments = projectRows.reduce((sum, row) => sum + (row.segment_count ?? 0), 0);
  const translatedSegments = projectRows.reduce((sum, row) => sum + (row.translated_count ?? 0), 0);

  return {
    id: workspaceRow.id,
    name: workspaceRow.name,
    userId: workspaceRow.user_id,
    updatedAt: new Date(workspaceRow.updated_at).getTime(),
    fileCount: projectRows.length,
    totalSegments,
    translatedSegments,
    files: projectRows
      .map((row) => ({
        id: row.id,
        workspaceId: workspaceRow.id,
        fileName: row.name,
        originalFileName: row.original_file_name,
        updatedAt: new Date(row.updated_at).getTime(),
        segmentCount: row.segment_count ?? 0,
        translatedCount: row.translated_count ?? 0,
        storagePath: row.storage_path ?? null,
      }))
      .sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { sensitivity: 'base' })),
  };
}

function buildEditorProject(workspaceRow, projectRow, segmentRows) {
  return {
    id: projectRow.id,
    userId: projectRow.user_id,
    workspaceId: workspaceRow.id,
    workspaceName: workspaceRow.name,
    projectName: workspaceRow.name,
    fileName: projectRow.name,
    originalFileName: projectRow.original_file_name,
    header: projectRow.header ?? ['Source', 'Target'],
    glossaryEntries: workspaceRow.glossary_entries ?? [],
    tmEntries: workspaceRow.tm_entries ?? [],
    currentSegmentId: projectRow.current_segment_id,
    storagePath: projectRow.storage_path ?? null,
    updatedAt: new Date(projectRow.updated_at).getTime(),
    createdAt: new Date(projectRow.created_at).getTime(),
    segments: [...segmentRows]
      .sort((a, b) => a.segment_number - b.segment_number)
      .map((row) => ({
        id: row.id,
        number: row.segment_number,
        source: row.source_text,
        target: row.target_text ?? '',
        status: row.status,
        tmMatchPercent: row.tm_match_percent,
      })),
  };
}

async function rebuildProjectFromStorage(projectRow, workspaceRow) {
  if (!projectRow.storage_path) {
    return null;
  }

  const { data: blob, error } = await supabase.storage.from('project-files').download(projectRow.storage_path);
  if (error) {
    throw error;
  }

  const parsedUpload = await parseSegmentBlob(blob, projectRow.original_file_name || `${projectRow.name}.xlsx`);
  const rebuilt = createSessionFromUpload(parsedUpload);

  return {
    id: projectRow.id,
    userId: projectRow.user_id,
    workspaceId: workspaceRow.id,
    workspaceName: workspaceRow.name,
    projectName: workspaceRow.name,
    fileName: projectRow.name,
    originalFileName: projectRow.original_file_name,
    header: rebuilt.header,
    glossaryEntries: workspaceRow.glossary_entries ?? [],
    tmEntries: workspaceRow.tm_entries ?? [],
    currentSegmentId: rebuilt.currentSegmentId,
    storagePath: projectRow.storage_path ?? null,
    updatedAt: new Date(projectRow.updated_at).getTime(),
    createdAt: new Date(projectRow.created_at).getTime(),
    segments: rebuilt.segments,
  };
}

export async function ensureProfile(user) {
  const { error } = await supabase.from('profiles').upsert(
    {
      id: user.id,
      email: user.email,
      full_name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? '',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );

  if (error) {
    throw error;
  }
}

export async function listWorkspacesByUser() {
  const [{ data: workspaces, error: workspaceError }, { data: projects, error: projectError }] = await Promise.all([
    supabase.from('workspaces').select('id, user_id, name, updated_at').order('updated_at', { ascending: false }),
    supabase.from('projects').select('id, workspace_id, name, original_file_name, segment_count, translated_count, updated_at, storage_path'),
  ]);

  if (workspaceError) {
    throw workspaceError;
  }

  if (projectError) {
    throw projectError;
  }

  return (workspaces ?? []).map((workspaceRow) =>
    buildWorkspaceSummary(
      workspaceRow,
      (projects ?? []).filter((projectRow) => projectRow.workspace_id === workspaceRow.id),
    ),
  );
}

export async function loadWorkspace(workspaceId) {
  const [{ data: workspaceRow, error: workspaceError }, { data: projectRows, error: projectError }] = await Promise.all([
    supabase
      .from('workspaces')
      .select('id, user_id, name, glossary_entries, tm_entries, created_at, updated_at')
      .eq('id', workspaceId)
      .single(),
    supabase
      .from('projects')
      .select('id, workspace_id, name, original_file_name, segment_count, translated_count, updated_at, storage_path')
      .eq('workspace_id', workspaceId)
      .order('name', { ascending: true }),
  ]);

  if (workspaceError) {
    throw workspaceError;
  }

  if (projectError) {
    throw projectError;
  }

  return buildWorkspaceSummary(workspaceRow, projectRows ?? []);
}

export async function loadProject(projectId) {
  const [{ data: projectRow, error: projectError }, { data: segmentRows, error: segmentError }] = await Promise.all([
    supabase
      .from('projects')
      .select('id, user_id, workspace_id, name, original_file_name, header, current_segment_id, storage_path, created_at, updated_at')
      .eq('id', projectId)
      .single(),
    supabase
      .from('project_segments')
      .select('id, segment_number, source_text, target_text, status, tm_match_percent')
      .eq('project_id', projectId),
  ]);

  if (projectError) {
    throw projectError;
  }

  if (segmentError) {
    throw segmentError;
  }

  const { data: workspaceRow, error: workspaceError } = await supabase
    .from('workspaces')
    .select('id, user_id, name, glossary_entries, tm_entries, created_at, updated_at')
    .eq('id', projectRow.workspace_id)
    .single();

  if (workspaceError) {
    throw workspaceError;
  }

  if (!(segmentRows ?? []).length) {
    // Only fall back to rebuilding from the uploaded file when the project truly has no
    // segments yet (e.g. first open after creation before any upsert runs).  If the
    // project row claims there are saved segments but none came back from the DB, something
    // transient went wrong (session hiccup, RLS, etc.).  Throw so the caller can fall back
    // to the local draft rather than silently replacing all translations with blank originals.
    if ((projectRow.segment_count ?? 0) > 0) {
      throw new Error('Project segments could not be loaded. Please try again.');
    }
    const rebuiltProject = await rebuildProjectFromStorage(projectRow, workspaceRow);
    if (rebuiltProject) {
      return rebuiltProject;
    }
  }

  return buildEditorProject(workspaceRow, projectRow, segmentRows ?? []);
}

export async function createCloudWorkspace({ workspace, files, originalsByFileId }) {
  const workspaceRow = {
    ...workspaceToRow(workspace),
    created_at: new Date(workspace.createdAt ?? Date.now()).toISOString(),
  };

  const { error: workspaceError } = await supabase.from('workspaces').insert(workspaceRow);
  if (workspaceError) {
    throw workspaceError;
  }

  const fileRows = [];
  for (const file of files) {
    const originalFile = originalsByFileId[file.id];
    let storagePath = null;

    if (originalFile) {
      const extension = originalFile.name.split('.').pop() ?? 'xlsx';
      storagePath = `${workspace.userId}/${workspace.id}/${file.id}.${extension}`;
      const { error: uploadError } = await supabase.storage.from('project-files').upload(storagePath, originalFile, {
        upsert: true,
        contentType: originalFile.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      if (uploadError) {
        throw uploadError;
      }
    }

    fileRows.push(
      fileToProjectRow({
        ...file,
        workspaceId: workspace.id,
        storagePath,
      }),
    );
  }

  const { error: projectError } = await supabase.from('projects').insert(fileRows);
  if (projectError) {
    throw projectError;
  }

  const segmentRows = fileRows.flatMap((fileRow, index) => files[index].segments.map((segment) => segmentToRow(fileRow.id, segment)));
  const { error: segmentsError } = await supabase.from('project_segments').insert(segmentRows);
  if (segmentsError) {
    throw segmentsError;
  }

  return loadWorkspace(workspace.id);
}

export async function saveProject(project) {
  const workspaceRow = {
    id: project.workspaceId,
    user_id: project.userId,
    name: project.workspaceName,
    glossary_entries: project.glossaryEntries ?? [],
    tm_entries: project.tmEntries ?? [],
    updated_at: new Date(project.updatedAt ?? Date.now()).toISOString(),
  };

  const { error: workspaceError } = await supabase.from('workspaces').update(workspaceRow).eq('id', project.workspaceId);
  if (workspaceError) {
    throw workspaceError;
  }

  const projectRow = fileToProjectRow({
    ...project,
    fileName: project.fileName,
  });

  const { error: projectError } = await supabase.from('projects').update(projectRow).eq('id', project.id);
  if (projectError) {
    throw projectError;
  }

  const { error: segmentsError } = await supabase.from('project_segments').upsert(project.segments.map((segment) => segmentToRow(project.id, segment)), {
    onConflict: 'id',
  });

  if (segmentsError) {
    throw segmentsError;
  }
}

export async function deleteProject(projectId, storagePath) {
  if (storagePath) {
    const { error: storageError } = await supabase.storage.from('project-files').remove([storagePath]);
    if (storageError) {
      throw storageError;
    }
  }

  const { error } = await supabase.from('projects').delete().eq('id', projectId);
  if (error) {
    throw error;
  }
}

export async function deleteWorkspace(workspaceId, files = []) {
  const storagePaths = files.map((file) => file.storagePath).filter(Boolean);

  if (storagePaths.length) {
    const { error: storageError } = await supabase.storage.from('project-files').remove(storagePaths);
    if (storageError) {
      throw storageError;
    }
  }

  const { error } = await supabase.from('workspaces').delete().eq('id', workspaceId);
  if (error) {
    throw error;
  }
}
