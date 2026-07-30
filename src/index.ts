export {
  character,
  part,
  layer,
  field,
  swap,
  limb,
  keys,
  sampled,
  ellipse,
  circle,
  rect,
  line,
  path,
  polygon,
  arc,
  arcPath,
  through,
  curvePath,
  ribbon,
  ribbonPath,
  linearGradient,
  radialGradient,
  clipPath,
  mask,
  activeChannels,
  CHANNELS,
  NEUTRAL,
  Character,
  PartHandle,
  FieldHandle,
  SwapHandle,
} from './scene.ts';
export type {
  Vec2, ViewBox, Track, Channel, ChannelName, Node,
  CharacterOptions, PartOptions, LimbOptions, ArcOptions, CurveOptions, RibbonOptions,
  FieldForm, MorphThroughOptions, PaintRef, PaintValue, PaintDefinition,
  ClipRef, ClipDefinition, MaskRef, MaskDefinition, MaskOptions, Definition,
  GradientStop, GradientUnits, GradientSpread, LinearGradientOptions, RadialGradientOptions,
} from './scene.ts';

export {
  linear, ease, easeIn, easeOut, easeInOut, glide, push, swing, cubicBezier, steps, parseEasing,
} from './easing.ts';
export type { Easing } from './easing.ts';

export { spring, settleTime, criticalDamping } from './spring.ts';
export type { SpringOptions } from './spring.ts';

export {
  score, Score, cueSheet, CueSheet, during, within, density, stagger, swell, shift, ramp, hold,
} from './score.ts';
export type { Beat, CueSpan, Shape, StaggerOptions } from './score.ts';

export { halftone, halftoneFile, plateSource } from './halftone.ts';
export type { Dot, Plate, HalftoneOptions } from './halftone.ts';

export { morph, shuffle } from './morph.ts';
export type { Move as MorphMove } from './morph.ts';

export { pathMorph, pathAt } from './path-morph.ts';
export type { PathMorphTuple, PathMorphKey, PathMorph } from './path-morph.ts';

export { toSceneIR, fromSceneIR, serializeScene, parseScene } from './ir.ts';
export type {
  IRKey, IRChannel, IRTrack, IRPathMorph, IRShape, IRNode, IRDefinition,
  SceneIR, SceneIROptions,
} from './ir.ts';

export { hasFfmpeg, videoArgs, renderVideo } from './video.ts';
export type { VideoOptions, VideoReport } from './video.ts';

export { solveTwoBone, reach } from './kinematics.ts';
export type {
  ReachStatus, TwoBoneOptions, TwoBoneSolution, ReachTarget, ReachOptions, ReachPose, Reach,
} from './kinematics.ts';

export { strokeFont, strokeText, geometricStrokeFont } from './type.ts';
export type {
  StrokeSegment, StrokeGlyph, StrokeFont, StrokeFontOptions,
  StrokeTextOptions, StrokeTextMetrics,
} from './type.ts';

export { OutlineFont, loadOutlineFont, fontPath, outlineText } from './font.ts';
export type {
  FontPathOptions, FontPathMetrics, FontPathResult, OutlineTextOptions,
} from './font.ts';

export { noise, aim } from './motion.ts';
export type { NoiseOptions, AimOptions } from './motion.ts';

export {
  evaluate, netPose, channelAt, trackAt, pointAt, worldMatrices, frameAt,
  sampleFrames, invert,
} from './timeline.ts';
export type { Pose, NodePose, Frame, Mat, TrackSnapshot } from './timeline.ts';

export {
  cssClass, definitionsSvg, renderContext, renderStatic, renderSheet, renderCueSheet, renderShapeSheet,
  listShapes, partBox, sceneBox, cueFrames, sheetTimes, sheetWidth, pathLength, strokeLength,
} from './render.ts';
export type { ShapeRef } from './render.ts';
export type { Box, RenderOptions, CueFrame, CueSheetRenderOptions } from './render.ts';
export { compile, keyframeName, EPSILON } from './compile.ts';
export type { CompileReport, CompileOptions } from './compile.ts';

export { lint, formatFindings } from './lint.ts';
export type { Finding } from './lint.ts';

export { walkCycle, bodyBob, sway, pulse, applyGait } from './behaviors/walk.ts';
export type { WalkOptions, WalkTracks, BobOptions } from './behaviors/walk.ts';

export { journey, stairs, flat, strideLength } from './behaviors/journey.ts';
export type { Journey, JourneyOptions, Move, Terrain } from './behaviors/journey.ts';

export { jump, hops } from './behaviors/jump.ts';
export type { JumpOptions, HopOptions } from './behaviors/jump.ts';

export { trace } from './trace.ts';
export { hasPotrace, outlinePaths } from './outline.ts';
export type { OutlineOptions } from './outline.ts';
export type { TraceOptions, TraceResult } from './trace.ts';
export { match, formatMatch } from './match.ts';
export type { MatchReport, MatchOptions, WidthProbe } from './match.ts';
export {
  loadImage, rasterise, inkMask, inkColour, distanceField, radiusField,
  coverage, softOverlap, totalCoverage,
  skeletonise, traceSkeleton, simplify, strokes, encodePng, junctions, crossingNumber,
  labelRegions, maskOfRegions,
} from './raster.ts';
export type { Bitmap, Mask, Coverage, Stroke } from './raster.ts';
