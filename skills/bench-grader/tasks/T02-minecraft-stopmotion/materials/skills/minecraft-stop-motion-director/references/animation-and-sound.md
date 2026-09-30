# Animation and Sound

## Table of contents

1. Stop-motion cadence
2. Rigid-body character construction
3. Body-language acting
4. Anticipation-action-reaction
5. Interaction and contact
6. Movement patterns
7. Environmental motion
8. Sound layers
9. Spatial audio
10. Music arc

## 1. Stop-motion cadence

Separate output frame rate from animation pose rate.

Typical defaults:

- output: 24 fps;
- character poses: 12 fps (hold 2 frames);
- stronger handmade look: 8 fps (hold 3 frames).

Do not interpolate every body joint every output frame unless the requested style is intentionally smooth. The visible pose holds create the stop-motion feel.

Cameras, fog, particles, light intensity, and some environmental motion may remain smoother. The contrast between a continuously photographed world and stepped character posing often looks more cinematic than making everything stutter.

## 2. Rigid-body character construction

Represent Minecraft-style humanoids as articulated cuboids or equivalent rigid pieces:

- Head
- Torso
- Left Arm
- Right Arm
- Left Leg
- Right Leg

Optional: hands, held-item anchors, cape, armor layers, facial texture variants.

Rotate body parts around believable block-character pivots. Preserve the iconic rigid silhouette.

## 3. Body-language acting

Because facial performance is limited, encode emotion through pose, timing, and eyeline.

Fear:
- freeze;
- lean back;
- head snap toward threat;
- arms lift slightly;
- short retreat.

Sadness:
- lowered head;
- slower pose changes;
- contracted posture;
- longer holds.

Surprise:
- abrupt stop;
- fast head turn;
- slight backward body shift;
- delayed reaction.

Resolve/determination:
- pause;
- look at target;
- square torso;
- raise/grip tool;
- step forward.

Affection/relief:
- relaxed shoulders/arms;
- smaller movements;
- closer spatial distance;
- shared eyeline or shared light source.

## 4. Anticipation-action-reaction

Apply this to every important interaction.

Example: axe strike

1. Look at the tree.
2. Adjust stance.
3. Raise axe.
4. Hold briefly.
5. Swing decisively.
6. Register impact through tool/body pose.
7. Trigger wood debris or block response.
8. Recoil/recover.

The pre-action hold makes the strike readable; the reaction gives it weight.

## 5. Interaction and contact

Validate contact in close shots:

- hand to tool grip;
- tool to impact point;
- feet to ground plane;
- wolf/mob feet to terrain;
- lantern to hook/support;
- placed block to grid;
- character to door/chest/workbench;
- projectile to launch direction.

A floating prop or a hand that misses the handle destroys the illusion faster than a modest texture mismatch.

## 6. Movement patterns

For walk cycles, alternate leg/arm opposition with small body height changes. Quantize to discrete poses rather than using smooth mocap.

For heavy actions, increase anticipation and recovery holds. For panic, shorten holds and increase pose contrast. For quiet emotional moments, reduce pose count and lengthen holds.

Use arcs sparingly because Minecraft limbs are rigid; prioritize strong readable silhouettes over physically perfect organic motion.

## 7. Environmental motion

Use environmental motion to keep the world alive while actors remain stepped:

- continuous fog drift;
- smooth snowfall with occasional clumps;
- water/lava movement;
- torch/fire flicker;
- subtle leaf/spore motion;
- drifting smoke/embers;
- light intensity variation.

Avoid excessive particle density that obscures pose readability.

## 8. Sound layers

Build the mix from layers:

1. ambience (wind, cave tone, lava, rain, forest, End hum);
2. footsteps and cloth/gear movement as needed;
3. block/tool interaction Foley;
4. mob/environment SFX;
5. impacts, transitions, and hero-prop cues;
6. music;
7. intentional silence.

Block placement, mining, doors, crafting, footsteps, bow shots, explosions, and portal activations should feel synchronized to visible contact frames.

## 9. Spatial audio

Match sound to camera and environment:

- distant sources quieter and less detailed;
- interiors slightly enclosed/reverberant;
- caves more reflective;
- open snow/fields drier and wider;
- threats approaching camera should grow in presence before visual confirmation when suspense helps.

Do not use identical loudness/reverb for every sound.

## 10. Music arc

For a one-minute short, a useful default is:

- opening: ambience first, sparse pad/texture;
- early story: introduce a simple motif;
- middle: add pulse/harmony as effort or danger rises;
- turn: strongest musical statement or deliberate silence before impact;
- resolution: release density;
- ending: sustained note, motif reprise, or ambience-only tail.

Prefer original or properly licensed music. Do not imitate a copyrighted track so closely that the result becomes a substitute for it.
