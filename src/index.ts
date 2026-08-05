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
  svgShape,
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
  Vec2, ViewBox, Track, Channel, ChannelName, PartTransform, Node,
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
  score, Score, cueSheet, CueSheet, during, within, withinAdditive, duringAdditive, density, stagger, swell, shift, ramp, hold,
} from './score.ts';
export type { Beat, CueSpan, Shape, StaggerOptions, AdditiveOptions } from './score.ts';

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
export { playbackTimes, deliveryProfile, endpointFrameClock } from './delivery.ts';
export type { DeliveryProfile } from './delivery.ts';

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
export { seeded } from './random.ts';
export type { NoiseOptions, AimOptions } from './motion.ts';

export {
  evaluate, netPose, nodePose, restPose, channelAt, trackAt, pointAt, worldMatrices, frameAt,
  sampleFrames, invert, localMatrix,
} from './timeline.ts';
export type { Pose, NodePose, Frame, Mat, TrackSnapshot } from './timeline.ts';

export {
  cssClass, definitionsSvg, renderContext, renderStatic, renderSheet, renderOverlaySheet, renderCueSheet,
  renderShapeSheet, renderMotionSheet, renderVariantSheet, prefixIds,
  listShapes, cueFrames, sheetTimes, sheetWidth, zoomBox, transformAttr,
  TRACK_HUES, MOTION_CELL, SHEET_CELL,
} from './render.ts';
export type { ShapeRef, NodeSvgOptions, VariantCell } from './render.ts';
export type { RenderOptions, CueFrame, CueSheetRenderOptions } from './render.ts';

export {
  partBox, sceneBox, subtreeCorners, localCorners, boxOfCorners, mergeBoxes,
  frameBox, shapeBox, shapeLength, pathPoints, pathLength, strokeLength, dashOffset,
} from './geometry.ts';
export type { Box } from './geometry.ts';

export {
  trackParts, trackable, resolvePart, resolveWindow, windowTimes, formatTrackReport,
  partLine, boxGap, plantedRun, CONTACT_BAND,
} from './track.ts';
export { grid, VariantSet, MAX_BUILDS } from './variants.ts';
export type { Axes, AxisValues, Variant, VariantMeta } from './variants.ts';
export type {
  TrackWindow, TrackRequest, TrackedSample, TrackOptions, TrackReport, PartTrack,
  Hold, Deceleration, Clearance, PlantedRun,
} from './track.ts';
export { compile, keyframeName, transformBakeReason, EPSILON } from './compile.ts';
export type { CompileReport, CompileOptions } from './compile.ts';

export { compileLottie, lottieContours } from './lottie.ts';
export type { LottieOptions, LottieReport, LottieResult } from './lottie.ts';
export { checkLottie, renderLottieFrame } from './lottie-check.ts';
export type { LottieCheckOptions, LottieCheckReport, LottieCheckSample } from './lottie-check.ts';

export { studio, curves, sampleCurves } from './studio.ts';
export type { StudioOptions, Curve, CurveSample } from './studio.ts';

export { lint, formatFindings } from './lint.ts';
export type { Finding, LintOptions } from './lint.ts';

export { walkCycle, bodyBob, sway, pulse, applyGait } from './behaviors/walk.ts';
export type { WalkOptions, WalkTracks, BobOptions } from './behaviors/walk.ts';

export { journey, stairs, flat, strideLength } from './behaviors/journey.ts';
export type { Journey, JourneyOptions, Move, Terrain } from './behaviors/journey.ts';

export { jump, hops } from './behaviors/jump.ts';
export type { JumpOptions, HopOptions } from './behaviors/jump.ts';

export { trace } from './trace.ts';
export { measuredRun, cutRun, joinRuns } from './runs.ts';
export type { MeasuredRun } from './runs.ts';
export { analyzeRig, rig } from './rig.ts';
export type { RigPart, RigReport, RigRunReport, RigCutSuggestion } from './rig.ts';
export { diffTakes, divergentTimes } from './diff.ts';
export type { DiffReport, PartDiff, ChannelDelta } from './diff.ts';
export { importSvgSource } from './import-svg.ts';
export type { ImportSvgOptions, ImportSvgResult } from './import-svg.ts';
export { hasPotrace, outlinePaths } from './outline.ts';
export type { OutlineOptions } from './outline.ts';
export type { TraceOptions, TraceResult } from './trace.ts';
export { match, matchBitmap, formatMatch } from './match.ts';
export type { MatchReport, MatchOptions, WidthProbe } from './match.ts';
export {
  loadImage, rasterise, inkMask, inkColour, distanceField, radiusField,
  coverage, softOverlap, totalCoverage,
  skeletonise, traceSkeleton, simplify, strokes, encodePng, junctions, crossingNumber,
  labelRegions, maskOfRegions,
} from './raster.ts';
export type { Bitmap, Mask, Coverage, Stroke } from './raster.ts';
