---
name: minecraft-stop-motion-director
description: Create, direct, and quality-control cinematic Minecraft-style 3D stop-motion videos from a user-specified theme. Use when the user asks for a Minecraft/MC 定格动画, 方块电影, cinematic block-world short, Steve/Alex story, voxel stop-motion film, storyboard-to-video pipeline, or a repeatable one-minute Minecraft animation workflow. Turn themes into emotion-first stories, preplanned cameras, block-built sets, stop-motion character acting, cinematic lighting, music/Foley, staged previews, rendering, and final delivery while avoiding false claims about outputs that were not actually produced.
---

# Minecraft Stop-Motion Director

Create an actual cinematic Minecraft-style stop-motion production, not a gameplay recording and not merely a prompt. Treat blocks as set construction, characters as actors, cameras as physical pre-rigged film cameras, practical light sources as story elements, and frame holds as the stop-motion language.

## Operating principle

Optimize every second around three questions:

1. What should the viewer see?
2. What should the viewer hear?
3. What should the viewer feel, and why?

Prefer a simple emotionally legible story over feature density. Keep the Minecraft visual grammar intact while using film-quality composition, lighting, atmosphere, sound, and editing.

## Required workflow

Execute the production in this order unless the user explicitly requests only one stage:

1. **Interpret the theme.** Extract premise, central emotion, protagonist, goal, obstacle/change, hero prop, ending feeling, environment, and tone.
2. **Compress the story.** Build one main dramatic line that can be understood without dialogue. For a roughly one-minute short, default to 8 beats and 8-12 shots.
3. **Minecraft-ify the action.** Express plot through blocks, tools, crafting, mobs, portals, redstone, building, mining, combat, survival, traversal, or other world-native actions rather than generic human drama pasted onto Minecraft characters.
4. **Define art direction.** Lock biome, block palette, texture strategy, weather, fog, particles, time of day, practical light sources, color contrast, and environment scale.
5. **Pre-rig cameras.** Assign every shot to a named camera before animation. Use separate Establishing, Character, Action, Close-up/Detail, Hero/Emotional, and Ending cameras as appropriate.
6. **Design performance.** Build pose-to-pose character acting with anticipation -> action -> reaction. Quantize character pose updates to stop-motion cadence while allowing smoother camera/environment motion.
7. **Design audio.** Layer ambience, footsteps, interaction Foley, world/mob sounds, impacts, music, and silence. Make audio intensity follow the story arc.
8. **Prototype first.** Render or generate representative keyframes/contact sheets before committing to the full sequence. Correct composition, occlusion, prop contact, pose readability, lighting, and environment logic.
9. **Produce the sequence.** Render/generate every shot, assemble them, mix audio, grade the film, and export the requested delivery format.
10. **Run final QC.** Inspect the full output for visual, temporal, audio, continuity, and delivery failures. Fix failures before claiming completion.

For deep creative logic and the 8-beat model, read `references/creative-method.md`.
For visual language, environment, camera, and lighting rules, read `references/cinematography-and-art.md`.
For stop-motion acting and sound design, read `references/animation-and-sound.md`.
For production, tool adaptation, QC, and delivery rules, read `references/production-and-qc.md`.
For a worked case study, read `references/example-the-last-light.md` only when an example would materially help.

## Capability gate

Before promising a final video, determine what the current environment can actually produce.

- **Full render path:** When a usable 3D/render/code/video toolchain exists, create and deliver the video.
- **Generative shot path:** When video generation exists but no controllable 3D renderer exists, create consistent shot references first, generate shots with locked character/environment/camera continuity, then edit and mix them into the final film.
- **Production-pack path:** When the environment cannot render or assemble video, deliver the highest-fidelity production pack possible: story, art direction, shot list, storyboard/contact sheet, camera plan, animation plan, audio cue sheet, prompts, manifests, and executable next steps. Explicitly state that no final video file was produced.

Never describe a storyboard, still image, HTML mockup, render plan, or nonexistent file as a completed video.

## Story defaults

For a ~60 second film, use this default timing only as a starting point:

- 0-7s: establish world
- 7-14s: introduce character
- 14-22s: reveal problem/opportunity
- 22-30s: commit to action
- 30-38s: escalate effort or danger
- 38-46s: decisive turn
- 46-54s: emotional result
- 54-60s: cinematic afterimage / visual echo

Use one main objective and one clear state change. Favor a hero prop that functions simultaneously as game object, visual focus, plot device, and emotional symbol.

## Visual non-negotiables

- Preserve voxel/block construction for terrain, architecture, vegetation, props, and characters wherever practical.
- Favor low-resolution pixel textures with high-quality rendering rather than photoreal textures that erase the Minecraft identity.
- Build primarily for the camera views that will actually be seen. Do not waste resources on a giant unseen world.
- Compose with foreground, subject/midground, and background depth whenever possible.
- Use weather, fog, particles, practical lights, and color contrast to create atmosphere and spatial separation.
- Keep camera motion restrained. Prefer slow push-in, dolly-out, pan, truck, tilt, or carefully motivated handheld movement.
- Avoid random free-flight camera motion, constant orbiting, or effects that exist only to look flashy.

## Stop-motion timing

Default final output to 24 fps when not otherwise specified. Default character pose cadence to 12 fps by holding each pose for 2 output frames. For a more handmade look, use 8 fps character cadence by holding poses for 3 output frames.

Allow cameras, fog, particles, light flicker, and some environmental motion to update more smoothly than character poses when that contrast improves the stop-motion feel.

## Character acting

Build Minecraft-style characters from rigid articulated cuboids or equivalent block forms. Treat body language as the primary emotion channel.

For every meaningful action:

1. Show intent or anticipation.
2. Execute the action with a readable silhouette.
3. Show physical/emotional reaction.
4. Insert a brief hold when the story beat needs emphasis.

Validate real contact between hands and tools, feet and ground, props and attachment points, and characters and environmental surfaces.

## Audio rules

Design sound as a parallel story track, not decoration.

- Establish location with ambience before filling the mix with music.
- Give block interactions and tools physical weight through Foley.
- Let distance, enclosure, and environment change loudness and reverb.
- Build music gradually, peak near the dramatic turn, and release into the ending.
- Use silence when it creates anticipation or makes an impact stronger.

## Research and intellectual-property hygiene

Use external references to study composition, lighting, environments, mechanics, or stop-motion technique when useful. Do not copy a proprietary map, animation, soundtrack, skin, texture pack, or other protected asset unless the user supplies it with permission or it is otherwise licensed for reuse.

When official Minecraft assets are unavailable or redistribution is inappropriate, create original Minecraft-inspired pixel textures, block geometry, sound design, and staging rather than pretending they are official assets.

## Reusable project assets

Use the files under `assets/project-template/` as copyable output scaffolding, not as reference prose:

- `project.json` - production-wide creative and technical manifest
- `shot-list.json` - per-shot camera/action/light/audio structure
- `audio-cue-sheet.csv` - editable timing sheet for ambience, Foley, SFX, and music
- `qc-report.md` - final review template
- `delivery-manifest.json` - artifact checklist for the final handoff

Use `assets/storyboard/storyboard-8-panel.svg` as an editable eight-panel storyboard sheet when a simple board template is useful.

To create a working project folder from the bundled template, run:

```bash
python scripts/create_project.py --title "My Film" --theme "user theme" --out /path/to/workdir
```

After editing the manifests, validate them with:

```bash
python scripts/validate_project.py /path/to/workdir
```

When rendered keyframes exist, create a contact sheet with:

```bash
python scripts/make_contact_sheet.py --input /path/to/keyframes --output /path/to/contact_sheet.jpg --columns 4
```

## Preview checkpoints

Require at least these checkpoints for a full production:

1. **Story lock:** premise and ending read clearly without dialogue.
2. **Storyboard lock:** shot order, camera positions, scale, and visual continuity read clearly.
3. **Look lock:** representative environment/character frames establish the final lighting and texture language.
4. **Animation lock:** one difficult interaction verifies pose cadence, contact, and prop handling.
5. **Final lock:** full film passes QC before delivery.

Do not skip directly from idea to full render when a cheaper preview can expose expensive mistakes.

## Final delivery

When actual files are produced, provide direct links to them and summarize only what really exists. Prefer these deliverables when available:

- final MP4
- poster/hero still
- storyboard/contact sheet
- project source or project bundle
- audio master or stems when useful
- manifest/QC report

Keep the user-facing summary compact. Put production details in the project files rather than burying the final handoff in a wall of prose.
