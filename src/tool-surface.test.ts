import {describe, expect, it} from 'vitest';
import {createChatToolSurface} from './chat-surface';
import {toChatToolSurface} from './tool-surface';
import type {ToolResult} from './types';
import {AnalysisEngine} from './analysis-commands';
import {createMockConnector} from './mock-connector';

describe('createChatToolSurface', () => {
  it('conforms to ChatToolSurface (listTools + invoke)', () => {
    const surface = createChatToolSurface({});
    expect(typeof surface.listTools).toBe('function');
    expect(typeof surface.invoke).toBe('function');
  });

  it('exposes map.* and analysis tool ids', () => {
    const surface = createChatToolSurface({});
    const tools = surface.listTools();
    expect(tools).toContain('map.set-basemap');
    expect(tools).toContain('data.query');
    expect(tools).toContain('geoda.analysis');
    expect(tools).toContain('geo.grid');
  });

  it('invokes analysis tools through the engine', async () => {
    const analysis = new AnalysisEngine(createMockConnector());
    const surface = createChatToolSurface({analysis});
    const res = await surface.invoke('data.query', {sql: 'SELECT 1 AS one'});
    expect(res.success).toBe(true);
  });

  it('rejects map tools without a mapHandler', async () => {
    const surface = createChatToolSurface({});
    const res = await surface.invoke('map.set-basemap', {});
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/mapHandler/);
  });

  it('routes map tools through a wired mapHandler', async () => {
    const handler = async (id: string): Promise<ToolResult> => ({success: true, data: {id}});
    const surface = createChatToolSurface({mapHandler: handler});
    const res = await surface.invoke('map.set-basemap', {style: 'dark'});
    expect(res.success).toBe(true);
    expect((res.data as {id?: string}).id).toBe('map.set-basemap');
  });

  it('errors without any backend wired', async () => {
    const surface = createChatToolSurface({});
    const res = await surface.invoke('data.query', {});
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/No backend wired/);
  });
});

describe('toChatToolSurface', () => {
  it('wraps an executor and validates its results', async () => {
    const surface = toChatToolSurface({
      knownTools: ['a', 'b'],
      invoke: async () => ({success: true, data: 1})
    });
    expect(surface.listTools()).toEqual(['a', 'b']);
    expect(await surface.invoke('a', {})).toEqual({success: true, data: 1});
  });

  it('returns an error for an invalid executor result', async () => {
    // The executor signature requires a real ToolResult, so the malformed
    // return has to be smuggled past the type checker to exercise the runtime
    // validation the wrapper exists for.
    const badInvoke = (async () => ({nope: true})) as unknown as (
      tool: string,
      input: unknown
    ) => Promise<ToolResult>;
    const surface = toChatToolSurface({invoke: badInvoke});
    const res = await surface.invoke('anything', {});
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Invalid result/);
  });
});
