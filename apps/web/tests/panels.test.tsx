import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSampleDocument } from '@buildview/design-engine';
import { useEditor } from '../src/state/editorStore.ts';
import { useUi } from '../src/state/uiStore.ts';
import { PropertiesPanel } from '../src/ui/PropertiesPanel.tsx';

beforeEach(() => {
  useEditor.getState().loadProject(
    { id: 'p', name: 'T', revision: 1, updatedAt: '', document: createSampleDocument(), editorMeta: {} },
    'postgres',
  );
  useUi.setState({ paintScope: 'selection' });
});

describe('PropertiesPanel', () => {
  it('shows an empty state with a building summary when nothing is selected', () => {
    render(<PropertiesPanel />);
    expect(screen.getByText('Nothing selected')).toBeInTheDocument();
    expect(screen.getByText('Storey height')).toBeInTheDocument();
    expect(screen.getByText('2.80 m')).toBeInTheDocument();
  });

  it('shows the selected wall id, true dimensions and current paint', () => {
    useEditor.getState().selectWall('wall-east');
    render(<PropertiesPanel />);
    expect(screen.getByTestId('wall-id')).toHaveTextContent('wall-east');
    expect(screen.getByTestId('wall-length')).toHaveTextContent('4.20 m'); // centre line = interior 4.0 + one thickness
    expect(screen.getByTestId('wall-height')).toHaveTextContent('2.80 m');
    expect(screen.getByTestId('wall-thickness')).toHaveTextContent('0.20 m');
    expect(screen.getByTestId('current-color')).toHaveTextContent('#9CAF88'); // Sage Green accent wall
  });

  it('paints only the selected wall from a swatch and keeps its dimensions', () => {
    useEditor.getState().selectWall('wall-north');
    render(<PropertiesPanel />);
    fireEvent.click(screen.getByRole('button', { name: /^Terracotta Red/ }));
    const { surfaces } = useEditor.getState().history.present;
    expect(surfaces['wall-north']?.color).toBe('#C4553B');
    expect(surfaces['wall-south']?.color).toBe('#F1EEE6');
    expect(screen.getByTestId('current-color')).toHaveTextContent('#C4553B');
    expect(screen.getByTestId('wall-length')).toHaveTextContent('5.20 m');
  });

  it('edits the floor and ceiling finish of a selected room', () => {
    useEditor.getState().select('room', ['room-living']);
    render(<PropertiesPanel />);
    expect(screen.getByTestId('room-id')).toHaveTextContent('room-living');
    expect(screen.getByTestId('room-area')).toHaveTextContent('20.00 m²');
    fireEvent.click(screen.getByRole('button', { name: /^Sage Green/ }));
    expect(useEditor.getState().history.present.surfaces['room-living:floor']?.color).toBe('#9CAF88');
    fireEvent.click(screen.getByRole('radio', { name: 'Ceiling' }));
    fireEvent.click(screen.getByRole('button', { name: /^Charcoal/ }));
    expect(useEditor.getState().history.present.surfaces['room-living:ceiling']?.color).toBe('#3A3D42');
    expect(useEditor.getState().history.present.surfaces['wall-north']?.color).toBe('#F1EEE6');
  });

  it('applies a colour to all walls when the scope is "All walls"', () => {
    useEditor.getState().selectWall('wall-north');
    render(<PropertiesPanel />);
    fireEvent.click(screen.getByRole('radio', { name: 'All walls' }));
    fireEvent.click(screen.getByRole('button', { name: /^Charcoal/ }));
    const { surfaces, walls } = useEditor.getState().history.present;
    expect(walls.every((w) => surfaces[w.id]?.color === '#3A3D42')).toBe(true);
  });

  it('applies to a selected group of walls', () => {
    const s = useEditor.getState();
    s.selectWall('wall-north');
    s.selectWall('wall-west', true);
    render(<PropertiesPanel />);
    expect(screen.getByRole('radio', { name: 'Selected walls (2)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Olive/ }));
    const { surfaces } = useEditor.getState().history.present;
    expect(surfaces['wall-north']?.color).toBe('#6B6B2F');
    expect(surfaces['wall-west']?.color).toBe('#6B6B2F');
    expect(surfaces['wall-east']?.color).toBe('#9CAF88');
  });

  it('disables metalness and texture scale for plain paint, and enables them for the matching finish', () => {
    useEditor.getState().selectWall('wall-north');
    render(<PropertiesPanel />);
    expect(screen.getByTestId('metalness')).toBeDisabled();
    expect(screen.getByTestId('texture-scale')).toBeDisabled();
    expect(screen.getByText(/Only the Metallic finish uses metalness/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Metallic' }));
    expect(screen.getByTestId('metalness')).toBeEnabled();
    fireEvent.change(screen.getByTestId('metalness'), { target: { value: '0.9' } });
    expect(useEditor.getState().history.present.surfaces['wall-north']?.metalness).toBe(0.9);

    fireEvent.click(screen.getByRole('radio', { name: 'Plaster' }));
    expect(screen.getByTestId('texture-scale')).toBeEnabled();
    fireEvent.change(screen.getByTestId('texture-scale'), { target: { value: '3' } });
    expect(useEditor.getState().history.present.surfaces['wall-north']?.textureScale).toBe(3);
  });

  it('roughness slider changes the real material value', () => {
    useEditor.getState().selectWall('wall-north');
    render(<PropertiesPanel />);
    fireEvent.change(screen.getByTestId('roughness'), { target: { value: '0.2' } });
    expect(useEditor.getState().history.present.surfaces['wall-north']?.roughness).toBe(0.2);
  });

  it('rotates a selected furniture item and lists furniture details', () => {
    useEditor.getState().selectFurniture('coffee-table');
    render(<PropertiesPanel />);
    const panel = within(screen.getByTestId('properties-panel'));
    expect(panel.getByText('Coffee table')).toBeInTheDocument();
    fireEvent.click(panel.getByRole('button', { name: 'Rotate right 15 degrees' }));
    expect(panel.getByTestId('furniture-rotation')).toHaveTextContent('15°');
  });

  it('explains that wall-mounted art cannot be moved', () => {
    useEditor.getState().selectFurniture('wall-art-main');
    render(<PropertiesPanel />);
    expect(screen.getByText(/wall-mounted and cannot be moved/)).toBeInTheDocument();
  });
});
