import { z } from 'zod';

/**
 * Canonical scene document contract.
 *
 * Layers are deliberately separate so a material edit can never touch geometry:
 *   - `room` + `walls`        -> structural geometry (metres, Y up, floor at y = 0)
 *   - `surfaces`              -> appearance, keyed by surface id (wall id, "floor", "ceiling")
 *   - `furniture`             -> movable objects
 *   - `lighting`              -> scene lighting settings
 *
 * Imported DXF/DWG geometry will eventually produce `room` + `walls` in this same shape.
 */

export const SCHEMA_VERSION = 1;

export const Vec2Schema = z.tuple([z.number().finite(), z.number().finite()]);
export type Vec2 = z.infer<typeof Vec2Schema>;

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected #RRGGBB colour');

export const FINISH_TYPES = ['matte', 'eggshell', 'satin', 'gloss', 'metallic', 'plaster'] as const;
export const FinishTypeSchema = z.enum(FINISH_TYPES);
export type FinishType = z.infer<typeof FinishTypeSchema>;

export const SurfaceMaterialSchema = z.object({
  color: HexColor,
  finish: FinishTypeSchema,
  roughness: z.number().min(0).max(1),
  metalness: z.number().min(0).max(1),
  /** Only meaningful for textured finishes (currently "plaster"). */
  textureScale: z.number().min(0.1).max(10),
});
export type SurfaceMaterial = z.infer<typeof SurfaceMaterialSchema>;

export const OpeningSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['window', 'glazed-door', 'doorway']),
  /** Centre of the opening measured along the wall from `start`, in metres. */
  offset: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
  /** Height of the opening's bottom edge above the floor. */
  sill: z.number().min(0),
});
export type Opening = z.infer<typeof OpeningSchema>;

export const WallSchema = z.object({
  /** Stable identifier. Never regenerated when appearance changes. */
  id: z.string().min(1),
  name: z.string().min(1),
  /** Endpoints of the wall's room-facing (interior) face line, in plan coordinates [x, z]. */
  start: Vec2Schema,
  end: Vec2Schema,
  /** Unit vector pointing away from the room interior; the wall thickens in this direction. */
  normal: Vec2Schema,
  height: z.number().positive(),
  thickness: z.number().positive(),
  /** Extra length past each end so corner joints are fully covered. */
  extendStart: z.number().min(0),
  extendEnd: z.number().min(0),
  openings: z.array(OpeningSchema),
});
export type Wall = z.infer<typeof WallSchema>;

export const RoomSchema = z.object({
  length: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
  wallThickness: z.number().positive(),
});
export type Room = z.infer<typeof RoomSchema>;

export const FURNITURE_KINDS = [
  'sofa',
  'coffee-table',
  'rug',
  'armchair',
  'tv-console',
  'plant',
  'wall-art',
] as const;
export const FurnitureKindSchema = z.enum(FURNITURE_KINDS);
export type FurnitureKind = z.infer<typeof FurnitureKindSchema>;

export const FurnitureItemSchema = z.object({
  id: z.string().min(1),
  kind: FurnitureKindSchema,
  name: z.string().min(1),
  /** Floor position [x, z] of the item's centre. */
  position: Vec2Schema,
  /** Rotation about the vertical axis in radians. */
  rotationY: z.number().finite(),
  /** Height of the item's base above the floor (wall art is mounted). */
  elevation: z.number().min(0),
  /** Footprint/size [width, height, depth] in local axes, metres. */
  size: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]),
  movable: z.boolean(),
  removable: z.boolean(),
  deleted: z.boolean(),
  home: z.object({ position: Vec2Schema, rotationY: z.number().finite() }),
});
export type FurnitureItem = z.infer<typeof FurnitureItemSchema>;

export const LIGHTING_PRESETS = ['daylight', 'evening'] as const;
export const LightingSchema = z.object({
  preset: z.enum(LIGHTING_PRESETS),
  /** 0..2 multiplier for ambient/hemisphere fill. */
  ambient: z.number().min(0).max(2),
  /** 0..4 multiplier for the directional sun/moon light. */
  sun: z.number().min(0).max(4),
  /** Ceiling and lamp lights on/off. */
  interior: z.boolean(),
});
export type Lighting = z.infer<typeof LightingSchema>;

export const SceneDocumentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  room: RoomSchema,
  walls: z.array(WallSchema).min(1),
  surfaces: z.record(z.string(), SurfaceMaterialSchema),
  furniture: z.array(FurnitureItemSchema),
  lighting: LightingSchema,
});
export type SceneDocument = z.infer<typeof SceneDocumentSchema>;

/** Surface ids that are not walls. */
export const FLOOR_SURFACE_ID = 'floor';
export const CEILING_SURFACE_ID = 'ceiling';

// ---------------------------------------------------------------- API contracts

export const ProjectNameSchema = z.string().trim().min(1).max(120);

export const CreateProjectRequestSchema = z.object({
  name: ProjectNameSchema.optional(),
  /** Only "sample" is supported in this version. */
  template: z.literal('sample').default('sample'),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;

export const SaveProjectRequestSchema = z.object({
  /** Revision the client last loaded/saved. Used for optimistic concurrency. */
  baseRevision: z.number().int().min(1),
  name: ProjectNameSchema.optional(),
  document: SceneDocumentSchema,
  /** Opaque editor metadata (camera, last view mode...). Kept small. */
  editorMeta: z.record(z.string(), z.unknown()).default({}),
});
export type SaveProjectRequest = z.infer<typeof SaveProjectRequestSchema>;

export const DuplicateProjectRequestSchema = z.object({ name: ProjectNameSchema.optional() });

export const ProjectSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  revision: z.number().int(),
  updatedAt: z.string(),
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const ProjectSchema = ProjectSummarySchema.extend({
  document: SceneDocumentSchema,
  editorMeta: z.record(z.string(), z.unknown()),
});
export type Project = z.infer<typeof ProjectSchema>;

export const HealthSchema = z.object({
  status: z.literal('ok'),
  storage: z.enum(['postgres', 'memory']),
});
export type Health = z.infer<typeof HealthSchema>;
