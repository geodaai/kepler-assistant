/**
 * The kepler-agnostic chat harness orchestration.
 *
 * This is the reusable browser harness layer that consumes the
 * `ChatToolSurface` contract (`listTools` + `invoke`). It contains the skills
 * runtime (`executeApi`, `runSkill`, `discoverSkill`, skill storage, model
 * resolution, prompt building), the shared AI-settings config, and the default
 * kepler-flavored `SEED_SKILLS` bundle. It does NOT depend on kepler.gl — the
 * host app (kepler.gl's demo-app) provides the kepler command registry as a
 * `ChatToolSurface` adapter; the kepler-flavored seed skills ship here as the
 * default and can be overridden per host.
 */

export * from './ai-tool-shim';
export * from './config';
export * from './skillPrompt';
export * from './getModel';
export * from './kepler-skill-storage';
export * from './runSkillTool';
export * from './discoverSkillTool';
export * from './executeApi/index';
export * from './seedSkills';
