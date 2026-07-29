export {
  character,
  part,
  layer,
  limb,
  keys,
  sampled,
  ellipse,
  circle,
  rect,
  line,
  path,
  polygon,
  activeChannels,
  CHANNELS,
  NEUTRAL,
  Character,
  PartHandle,
} from './scene.ts';
export type {
  Vec2, ViewBox, Track, Channel, ChannelName, Node,
  CharacterOptions, PartOptions, LimbOptions,
} from './scene.ts';

export { linear, ease, easeIn, easeOut, easeInOut, glide, push, swing, cubicBezier, steps } from './easing.ts';
export type { Easing } from './easing.ts';

export { evaluate, channelAt, trackAt, pointAt, worldMatrices, frameAt, sampleFrames } from './timeline.ts';
export type { Pose, NodePose, Frame, Mat } from './timeline.ts';

export { renderStatic, renderSheet, partBox, sceneBox, sheetTimes, sheetWidth } from './render.ts';
export type { Box, RenderOptions } from './render.ts';
export { compile, EPSILON } from './compile.ts';
export type { CompileReport, CompileOptions } from './compile.ts';

export { lint, formatFindings } from './lint.ts';
export type { Finding } from './lint.ts';

export { walkCycle, bodyBob, sway, pulse, applyGait } from './behaviors/walk.ts';
export type { WalkOptions, WalkTracks, BobOptions } from './behaviors/walk.ts';
