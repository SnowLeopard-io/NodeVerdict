export { parseSourceMap, originalPositionFor, generatedLinesForOriginal, hasMapping } from './source-map-resolver';
export type { SourceMapData, SourceMapEntry, DecodedMappings } from './source-map-resolver';
export { parseStack, resolveFrames, linkStackTrace, isRuntimeFrame, isNativeFrame } from './code-linker';
export type { StackFrame, ResolvedStack, SourceMapLoader } from './code-linker';
export { createFsAccessBridge, fromMemory } from './fs-access-bridge';
export type { SourceFsBridge } from './fs-access-bridge';
export { attributeSpans, appFramesFromStack } from './source-attribution';
export type { AttributionSite, SourceAttributionStats } from './source-attribution';