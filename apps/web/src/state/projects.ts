import { api } from '../api/client.ts';
import { useEditor } from './editorStore.ts';
import { useImports } from './importStore.ts';

/** Creates a project on the server and opens it. Throws if the API is unreachable. */
export async function createAndOpenProject(template: 'blank' | 'sample', name?: string) {
  if (useEditor.getState().dirty && !(await useEditor.getState().saveProject())) {
    throw new Error('Save or discard your current changes before opening another project.');
  }
  const project = template === 'blank' ? await api.createBlank(name) : await api.createSample(name);
  useImports.getState().reset();
  useEditor.getState().loadProject(project, useEditor.getState().storage ?? 'postgres');
  return project;
}

export async function openExistingProject(id: string) {
  if (useEditor.getState().dirty && !(await useEditor.getState().saveProject())) {
    throw new Error('Save or discard your current changes before opening another project.');
  }
  const project = await api.get(id);
  useImports.getState().reset();
  useEditor.getState().loadProject(project, useEditor.getState().storage ?? 'postgres');
}
