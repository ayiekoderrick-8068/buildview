import { z } from 'zod';

/**
 * Canonical BuildView building document (schema version 2).
 *
 * COORDINATES (single documented mapping used everywhere):
 *   - Plan space: metres, x = east, y = NORTH (CAD convention), origin = project origin.
 *   - World/3D space (Three.js): X = plan x, Y = up (height above level floor), Z = -plan y.
 *   - A plan point (x, y) at height h therefore maps to world (x, h, -y).
 *   - Wall rotation about Y for a plan direction (dx, dy) is atan2(dy, dx).
 *
 * LAYERS (so a material edit can never touch geometry):
 *   - structure : levels, walls, openings, rooms
 *   - appearance: surfaces, keyed by element id (wall id, "<roomId>:floor", "<roomId>:ceiling", "roof")
 *   - objects   : furniture
 *   - lighting
 *   - provenance: sources, element sourceHandles, verification status
 *
 * The Three.js scene graph and any exported GLB are DERIVED from this document, never authoritative.
 */

export const SCHEMA_VERSION = 2;

export const Vec2Schema = z.tuple([z.number().finite(), z.number().finite()]);
export type Vec2 = z.infer<typeof Vec2Schema>;

export const PtSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
export type Pt = z.infer<typeof PtSchema>;

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected #RRGGBB colour');
const Id = z.string().min(1).max(80);

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

/** How trustworthy an element is. Imported/derived elements start as detected/needs-review. */
export const VERIFICATION_STATUSES = ['detected', 'needs-review', 'reviewed', 'manual'] as const;
export const VerificationStatusSchema = z.enum(VERIFICATION_STATUSES);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

const Provenance = {
  /** DXF entity handles this element was derived from (traceability to the original drawing). */
  sourceHandles: z.array(z.string().max(40)).max(64).default([]),
  verificationStatus: VerificationStatusSchema.default('manual'),
  /** Human-readable notes, e.g. "height is a default - not in drawing". */
  notes: z.array(z.string().max(200)).max(8).default([]),
};

export const LevelSchema = z.object({
  id: Id,
  name: z.string().min(1).max(80),
  elevationM: z.number().finite(),
  /** Default floor-to-ceiling height. */
  heightM: z.number().positive(),
});
export type Level = z.infer<typeof LevelSchema>;

export const WallSchema = z.object({
  id: Id,
  levelId: Id,
  name: z.string().min(1).max(80),
  /** Centreline endpoints. */
  start: PtSchema,
  end: PtSchema,
  thicknessM: z.number().positive(),
  heightM: z.number().positive(),
  ...Provenance,
});
export type Wall = z.infer<typeof WallSchema>;

export const OPENING_KINDS = ['door', 'doorway', 'window', 'glazed-door'] as const;
export const OpeningSchema = z.object({
  id: Id,
  wallId: Id,
  kind: z.enum(OPENING_KINDS),
  /** Distance of the opening's CENTRE from the wall's start point, along the centreline. */
  offsetM: z.number().finite(),
  widthM: z.number().positive(),
  heightM: z.number().positive(),
  /** Height of the opening's bottom edge above the level floor. */
  sillM: z.number().min(0),
  ...Provenance,
});
export type Opening = z.infer<typeof OpeningSchema>;

export const RoomSchema = z.object({
  id: Id,
  levelId: Id,
  name: z.string().min(1).max(80),
  /** Interior boundary, counter-clockwise in plan space. */
  polygon: z.array(PtSchema).min(3).max(500),
  ...Provenance,
});
export type Room = z.infer<typeof RoomSchema>;

export const FURNITURE_KINDS = ['sofa', 'coffee-table', 'rug', 'armchair', 'tv-console', 'plant', 'wall-art'] as const;
export const FurnitureKindSchema = z.enum(FURNITURE_KINDS);
export type FurnitureKind = z.infer<typeof FurnitureKindSchema>;

export const FurnitureItemSchema = z.object({
  id: Id,
  kind: FurnitureKindSchema,
  name: z.string().min(1),
  levelId: Id.optional(),
  /** Floor position [x, y] in PLAN coordinates (y = north). */
  position: Vec2Schema,
  /** Rotation about the vertical (world Y) axis in radians. */
  rotationY: z.number().finite(),
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
  ambient: z.number().min(0).max(2),
  sun: z.number().min(0).max(4),
  interior: z.boolean(),
});
export type Lighting = z.infer<typeof LightingSchema>;

/** Reference to an uploaded CAD file. The file itself is stored privately and never modified. */
export const SourceRefSchema = z.object({
  sourceId: Id,
  importJobId: Id,
  fileName: z.string().max(200),
  sha256: z.string().length(64),
  /** Drawing units the architect confirmed, and the resulting scale to metres. */
  confirmedUnit: z.enum(['mm', 'cm', 'm', 'in', 'ft']),
  toMetres: z.number().positive(),
  /** layer name -> category chosen by the architect. */
  layerMap: z.record(z.string(), z.enum(['wall', 'door', 'window', 'room', 'ignore'])),
  /** Translation (metres) subtracted from drawing coordinates so the plan is centred near the origin. */
  originM: PtSchema,
  /** Notes produced by recognition (unsupported entities, assumptions, repaired gaps). */
  issues: z
    .array(
      z.object({
        code: z.string().max(60),
        severity: z.enum(['critical', 'warning', 'info']),
        message: z.string().max(400),
        sourceHandles: z.array(z.string().max(40)).max(32).default([]),
      }),
    )
    .max(200)
    .default([]),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

export const RoofSchema = z.object({
  kind: z.literal('flat'),
  thicknessM: z.number().positive().max(2),
  overhangM: z.number().min(0).max(3),
});
export type Roof = z.infer<typeof RoofSchema>;

export const ApprovalSchema = z.object({
  status: z.enum(['draft', 'approved']),
  approvedAt: z.string().nullable(),
});

export const SceneDocumentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  levels: z.array(LevelSchema).min(1),
  walls: z.array(WallSchema),
  openings: z.array(OpeningSchema),
  rooms: z.array(RoomSchema),
  roof: RoofSchema.nullable().default(null),
  surfaces: z.record(z.string(), SurfaceMaterialSchema),
  furniture: z.array(FurnitureItemSchema),
  lighting: LightingSchema,
  sources: z.array(SourceRefSchema).default([]),
  /** Keys of validation issues the architect acknowledged (warnings/info only). */
  acknowledgedIssues: z.array(z.string().max(200)).default([]),
  approval: ApprovalSchema.default({ status: 'draft', approvedAt: null }),
});
export type SceneDocument = z.infer<typeof SceneDocumentSchema>;

export const FLOOR_SUFFIX = ':floor';
export const CEILING_SUFFIX = ':ceiling';
export const ROOF_SURFACE_ID = 'roof';
export const floorSurfaceId = (roomId: string) => `${roomId}${FLOOR_SUFFIX}`;
export const ceilingSurfaceId = (roomId: string) => `${roomId}${CEILING_SUFFIX}`;

// ---------------------------------------------------------------- Validation issues

export const ISSUE_SEVERITIES = ['critical', 'warning', 'info'] as const;
export const ValidationIssueSchema = z.object({
  /** Deterministic key: code + affected ids. Stable across runs, used for acknowledgement. */
  key: z.string(),
  code: z.string(),
  severity: z.enum(ISSUE_SEVERITIES),
  elementIds: z.array(z.string()),
  message: z.string(),
  suggestion: z.string().optional(),
  status: z.enum(['open', 'acknowledged']),
  sourceHandles: z.array(z.string()),
});
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

// ---------------------------------------------------------------- CAD import contracts

const P2 = z.tuple([z.number(), z.number()]);
export const CadEntitySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('LINE'), handle: z.string(), layer: z.string(), a: P2, b: P2 }),
  z.object({
    type: z.literal('POLYLINE'),
    handle: z.string(),
    layer: z.string(),
    /** [x, y, bulge] */
    points: z.array(z.tuple([z.number(), z.number(), z.number()])),
    closed: z.boolean(),
  }),
  z.object({
    type: z.literal('ARC'),
    handle: z.string(),
    layer: z.string(),
    center: P2,
    radius: z.number(),
    startDeg: z.number(),
    endDeg: z.number(),
  }),
  z.object({ type: z.literal('CIRCLE'), handle: z.string(), layer: z.string(), center: P2, radius: z.number() }),
]);
export type CadEntity = z.infer<typeof CadEntitySchema>;

export const CadInsertSchema = z.object({
  handle: z.string(),
  name: z.string(),
  layer: z.string(),
  at: P2,
  rotationDeg: z.number(),
  scale: P2,
  /** Axis-aligned bounds of the exploded block geometry in drawing units: [minx, miny, maxx, maxy]. */
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
});
export type CadInsert = z.infer<typeof CadInsertSchema>;

export const CadParseResultSchema = z.object({
  format: z.literal('dxf'),
  dxfVersion: z.string(),
  units: z.object({
    insunits: z.number().int(),
    name: z.string(),
    /** Scale to metres when the header unit is recognised, otherwise null (user must confirm). */
    toMetres: z.number().positive().nullable(),
  }),
  extents: z.object({ min: P2, max: P2 }).nullable(),
  layers: z.array(z.object({ name: z.string(), entityCount: z.number().int(), types: z.record(z.string(), z.number().int()) })),
  entities: z.array(CadEntitySchema),
  inserts: z.array(CadInsertSchema),
  unsupported: z.array(z.object({ type: z.string(), count: z.number().int(), sampleHandles: z.array(z.string()) })),
  warnings: z.array(z.string()),
  truncated: z.boolean(),
});
export type CadParseResult = z.infer<typeof CadParseResultSchema>;

export const IMPORT_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const;
export const ImportJobSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  projectId: z.string(),
  status: z.enum(IMPORT_STATUSES),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  fileName: z.string(),
  format: z.enum(['dxf', 'dwg']),
  sha256: z.string(),
  sizeBytes: z.number().int(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  result: CadParseResultSchema.nullable(),
});
export type ImportJob = z.infer<typeof ImportJobSchema>;

export const CapabilitiesSchema = z.object({
  dxf: z.boolean(),
  dwg: z.boolean(),
  dwgReason: z.string().nullable(),
  malwareScanning: z.boolean(),
  maxUploadBytes: z.number().int(),
});
export type Capabilities = z.infer<typeof CapabilitiesSchema>;

// ---------------------------------------------------------------- API contracts

export const ProjectNameSchema = z.string().trim().min(1).max(120);

export const CreateProjectRequestSchema = z.object({
  name: ProjectNameSchema.optional(),
  /** "sample" = fictional living room, "blank" = empty single-storey plan to draw or import into. */
  template: z.enum(['sample', 'blank']).default('sample'),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;

export const SaveProjectRequestSchema = z.object({
  baseRevision: z.number().int().min(1),
  name: ProjectNameSchema.optional(),
  document: SceneDocumentSchema,
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
  capabilities: CapabilitiesSchema.optional(),
});
export type Health = z.infer<typeof HealthSchema>;
