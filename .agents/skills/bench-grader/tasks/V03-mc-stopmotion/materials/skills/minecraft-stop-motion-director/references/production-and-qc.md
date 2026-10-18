# Production and QC

## Table of contents

1. Production architecture
2. Tool adaptation
3. Project manifests
4. Preview strategy
5. Render/assembly strategy
6. QC categories
7. Minecraft-specific failure list
8. Delivery standards
9. Recovery strategy

## 1. Production architecture

Treat the project as a small studio pipeline:

**Theme -> Writer -> Director -> Art direction -> Storyboard -> Scene build -> Camera rig -> Animation -> Lighting/FX -> Render/generation -> Sound -> Edit -> QC -> Delivery.**

One AI may perform all roles, but separate the decisions so problems remain debuggable.

## 2. Tool adaptation

Choose the highest-control path actually available.

### Controllable 3D path

Use when a renderer/game engine/code pipeline can build scenes and render frames. Prefer this for strict block geometry, exact camera placement, prop contact, lighting continuity, and deterministic stop-motion cadence.

### Generative video path

Use when a video model is available but 3D rendering is not. Lock continuity through shared reference images, character sheets, environment keyframes, camera descriptions, and repeated style language. Generate short shots rather than a single uncontrolled 60-second prompt. Assemble shots afterward.

### Hybrid path

Use 3D or image generation for stable keyframes/storyboards, then video generation for motion. This can improve continuity while keeping production practical.

### Planning-only path

When actual media production tools are unavailable, do not fabricate a video. Deliver a production-ready package that another renderer/model can consume.

## 3. Project manifests

Maintain a machine-readable source of truth. Recommended files:

- `project.json`: story, visual, technical, camera, and audio defaults;
- `shot-list.json`: per-shot timing, camera, action, lighting, sound, continuity state;
- `audio-cue-sheet.csv`: cues by time and layer;
- `delivery-manifest.json`: expected output artifacts;
- `qc-report.md`: checks and fixes.

Use the bundled asset templates and `scripts/create_project.py` to initialize them.

## 4. Preview strategy

Do not full-render first.

### Story lock

Read the story without dialogue. Confirm protagonist, goal, obstacle/change, decisive action, and ending state.

### Storyboard lock

Create 8-12 panels/keyframes. Inspect shot order, geography, subject scale, screen direction, and prop continuity.

### Look lock

Render representative exterior/interior/action/emotional frames. Lock texture density, contrast, fog, exposure, shadow softness, particle density, and color palette.

### Animation lock

Test the most difficult interaction (tool strike, block placement, combat contact, portal entry, creature interaction). Confirm pose cadence and attachment.

### Final lock

Watch the full output at normal speed and at least once muted. Then inspect key problem areas frame-by-frame.

## 5. Render/assembly strategy

For frame rendering, name frames deterministically and keep shot boundaries explicit. Render enough handles for transitions only when needed.

For generative shots, target short clips whose action can be described unambiguously. Preserve camera identity and avoid asking a single generation to perform several unrelated beats.

When assembling:

- preserve intended shot timing;
- use hard cuts by default unless transition has narrative motivation;
- grade shots into one palette;
- normalize exposure and black levels;
- synchronize Foley to visible contacts;
- preserve a short audio tail at the end when appropriate.

## 6. QC categories

### Story

- Can a viewer explain what happened without dialogue?
- Does the climax resolve or transform the initial situation?
- Does the ending echo the opening or hero prop?

### Visual

- Is the subject readable in every shot?
- Are foreground elements unintentionally blocking the action?
- Do textures/geometry remain stylistically consistent?
- Are shadows, fog, and particles plausible?

### Animation

- Are pose holds intentional and consistent?
- Do anticipation and reaction exist for key actions?
- Do contacts line up?
- Are movements free of accidental smooth interpolation or popping unrelated to the stop-motion style?

### Camera

- Does every camera have a reason?
- Are screen direction and eyelines coherent?
- Does the camera clip through blocks/characters?
- Is movement restrained and motivated?

### Audio

- Is Foley synchronized?
- Does ambience match the environment?
- Are music and effects clipping?
- Is dialogue/voiceover, if any, intelligible?
- Does spatial distance feel plausible?

### Delivery

- Is the final duration correct?
- Is resolution/frame rate correct?
- Does the final file open and play end-to-end?
- Are all linked deliverables real and accessible?

## 7. Minecraft-specific failure list

Explicitly inspect for:

1. feet below or above the terrain;
2. tool not seated in the hand;
3. tool intersecting torso/head;
4. floating lantern/prop/block;
5. wolf/mob feet not touching ground;
6. half-block or off-grid placement errors where full-grid placement is intended;
7. building/tree/foreground hiding the actor during a key action;
8. camera clipping through walls/blocks;
9. snow/rain appearing inside sealed interiors;
10. light source glowing without affecting nearby surfaces;
11. broken block/placed block state resetting in later shots;
12. portal/fire/redstone state changing without cause;
13. character hand switching between shots without motivation;
14. incompatible pixel scale between adjacent materials;
15. smooth organic limb deformation that breaks the rigid block-character style.

## 8. Delivery standards

When available, provide:

- final MP4 (or user-requested video format);
- poster/hero still;
- storyboard/contact sheet;
- project/source bundle;
- audio master/stems when useful;
- QC report and delivery manifest.

Do not claim source files, audio stems, 3D scenes, or videos exist unless they were actually created.

## 9. Recovery strategy

When a checkpoint fails, fix the cheapest upstream cause first:

- unclear story -> rewrite beats before rendering;
- weak composition -> move camera/set dressing before animation;
- unreadable interaction -> restage pose/prop before lighting polish;
- lighting inconsistency -> fix practical source logic before color grade;
- continuity drift in generated video -> shorten shot, strengthen references, or replace with more controllable method;
- audio timing issue -> lock picture before final mix.

Prefer partial high-quality completion over pretending an unavailable stage succeeded.
