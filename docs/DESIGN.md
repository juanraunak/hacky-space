

# Space Rescue: Game Design
2026-10-24 · Juan

## The game
A co-op space rescue game where your crew is scattered across a dying star system and you and your friends fly out to bring every one of them home before the star explodes.
Each crewmate is trapped somewhere that only one of Einstein's rules can get you out of. Nobody explains the rules. Space just works that way, and you figure it out because you have to.
It is one hand-built game inside Hacky: proof that a world model can simulate anything, even general relativity, and that friends can learn it by playing together.
Three rules we never break:
- 
No quizzes, no tooltips, no "correct!" popups, no score. The rescue either works or it doesn't.
- 
The rule is named only once, after you have already used it, as a crewmate's thought.
- 
Failing is part of it. You come back knowing more.

## What we are teaching: general relativity
Einstein's 1915 idea, in four plain points. Every one of them is a mechanic in the game.
The rule
In plain words
In the game
Gravity is bent space
A heavy thing makes a dip in space, like a bowling ball on a trampoline. Things roll toward it because the surface is bent
Your ship curves toward stars and black holes. Too close and you can't climb out
Time slows near heavy things
The deeper you are in the dip, the slower your clock really ticks
Near a black hole your clock slows. Your oxygen lasts longer, but everyone else's time races ahead
Light bends
Light follows the bent space too, so heavy things warp what's behind them
Black holes and dark matter visibly bend the stars behind them. That's how you find hidden things
Speed slows time, nothing beats light
The faster you go, the slower your clock. Light speed is a hard wall
Flying fast saves oxygen. Your ship gets "heavier" near light speed and can never pass it
The real formulas we use are in the Mechanics section. They are simplified for a game, but every effect points the right way and has the right shape.

## Story
The whole run is one rescue: get every crewmate back to the mothership before the star explodes. Runs last 10 to 15 minutes.
1. Opening event (about 30 seconds, no controls). The mothership orbits a swollen red star. The star flares. A shockwave tears through the hull and the crew are thrown out into space, each pod flung toward a different part of the system. The players are the pilots who made it to the rescue ships. The camera pulls back to show the star pulsing and a countdown appearing: the time until it goes supernova.
2. The search. Every lost crewmate sends a distress beacon. The HUD shows a rough direction to each one, never the exact spot. Players split up or go together and fly out into the system.
3. The rescues. Each crewmate is trapped in a different POI (next section). You reach them, solve the problem that place throws at you, tether their pod and tow it home.
4. The reunion. When a pod is docked, the crewmate wakes up and thinks out loud in a bubble. Their clock is behind yours, because time ran slower where they were stuck. The first time this happens is the only moment the game names the rule.
5. The ending. All crew docked before the countdown hits zero: the mothership jumps away as the star explodes behind it. Win.

### How you fail
What happens
Result
Countdown hits zero with crew still out
Star explodes. Run over for everyone. The crew you saved are shown, the ones you didn't are shown frozen where they were
Your oxygen runs out
Your ship goes dark and drifts. A teammate can tow you back to the mothership to refill. Solo, you respawn at the mothership and lose 30 seconds
You cross a black hole's horizon
Gone, no rescue. Respawn at the mothership. Your tethered crewmate falls in with you
Pulsar beam hits you
Hull damage. Three hits and you go dark like running out of oxygen

## Rescue POIs: where the crew are trapped
Six kinds of rescue site. Each one leans on exactly one rule, each has an obvious approach that fails, and each has one approach that works. Getting it wrong once or twice is the intended path.
POI
Rule it teaches
Obvious move that fails
What actually works
Black hole edge
Time slows near heavy things
Fly straight at the pod
Spiral in slowly, hover, tether, climb out at an angle
Dark matter cloud
Invisible mass still bends light and paths
Search by looking for the pod
Read the bent starlight to find the hidden centre
Far orbit (slingshot)
Gravity is bent space
Fly there with your engine
Dive past a star and slingshot to steal its speed
Wormhole
Time is not the same on both sides
Go through and come back expecting nothing changed
Go through, grab them, come back, and plan for the clock gap
Pulsar
Gravity and timing
Fly in while the beam is away
Read the beam's rhythm and stay in its shadow
Runaway pod
Nothing beats light, speed slows time
Thrust flat out to catch it
Chase it while your clock slows; cut the angle, don't just push

### 1. Black hole edge
What you see: a pitch black circle with a glowing ring, the stars behind it smeared into arcs. A crewmate's pod is near the edge. On your screen the pod is barely moving and glowing deep red.
The problem: the pod is deep in the well. To you it looks frozen, because its time is crawling. Fly straight in and the pull grabs you faster than your engine can fight it.
How you save them: come in on a curve, slow down as you get close, and hover just outside the danger zone long enough to clip a tether on. Then climb out sideways, not straight up. While you are deep, your own clock slows: your oxygen lasts longer, but the star's countdown and your friends keep running at full speed.
How you fail: cross the horizon and you are gone, pod and all.
When you get back: this crewmate's clock is the furthest behind of anyone. This is usually the reunion that names the rule.

### 2. Dark matter cloud
What you see: a patch of space that looks empty. Faint haze at most. Your ship keeps drifting sideways for no visible reason.
The problem: the pod's beacon is somewhere in here, but there is nothing to look at. The mass that's pulling you is invisible.
How you save them: look at the stars behind the cloud. They are bent and stretched around a point. That point is the centre of the hidden mass, and the pod is stuck there. Fly to the centre of the distortion.
How you fail: wander by eye and run out of oxygen. No instant death here, just slow loss.

### 3. Far orbit (slingshot)
What you see: a pod drifting on the far side of a big star, very far away. The distance readout makes it clear your engine won't get there in time.
The problem: flying straight there burns too much time and oxygen.
How you save them: dive toward the star, skim past it, and let its gravity whip you around and fling you out much faster. Line up the exit toward the pod. Same trick on the way home.
How you fail: skim too close and the star's heat damages you; too far and you get almost no boost.

### 4. Wormhole
What you see: a sphere that shows a different piece of sky inside it, with a swirl around the rim. The crewmate's beacon comes from inside, from somewhere else entirely.
The problem: the crewmate fell through. You have to follow them to the other side.
How you save them: fly through, find the pod near the exit, tether it and come back through. The two mouths are in different gravity, so time ran at different speeds on each side. When you return, more time has passed on the countdown than you felt.
How you fail: get lost on the far side. The exit mouth is always visible as a bright point, so it's a time loss, not a death.

### 5. Pulsar
What you see: a tiny, very bright dead star spinning fast, sweeping two beams of light around like a lighthouse. The pod is in a close orbit around it.
The problem: the beams damage you. They sweep on a steady rhythm. The pulsar is also very heavy for its size, so its gravity is strong up close.
How you save them: watch the rhythm, then move in during the gap and stay in the beam's shadow. Tether and leave on the next gap.
How you fail: three beam hits and your ship goes dark.

### 6. Runaway pod
What you see: a pod that was flung out at huge speed and is still racing away from the system.
The problem: you have to catch something already moving very fast. Thrust harder and harder, and your speed stops climbing the way you expect. You can never go faster than light, and the closer you get to it, the less each push adds.
How you save them: cut across its path at an angle instead of chasing directly behind it. While you're fast, your clock slows, so the long chase costs less oxygen than it looks.
How you fail: run out of countdown on the long trip back. The runaway pod is always the furthest from home.

### Which POIs appear
- 
Black hole and dark matter appear in every run: they carry the main lessons.
- 
The rest are drawn from the seed, so each run feels different.
- 
Never two of the same kind until every kind has appeared once.

## Other places in the world
Not every spot holds a crewmate. These fill the space between rescues and either help or hurt.
Place
What it is
What it does to you
Mothership
Home base, orbiting the dying star
Dock to drop off a crewmate and refill oxygen. Always visible as a bright marker
The dying star
Huge, red, pulsing at the centre of the system
Strong gravity, heat damage up close. Its pulse speeds up as the countdown runs out
Stars
Ordinary stars scattered around
Gravity to slingshot off. Heat if you skim too close
Planets
Rocky or ringed, some with moons
Gentle gravity, safe slingshots, good for learning orbits early
Nebula
Big glowing clouds of gas
Slows your ship down a lot (drag). Hides things. Pretty but costly
Empty void
Nothing but stars
Safe. Fastest way to cross the map. Your clock runs at its normal rate
Asteroid field (optional)
Drifting rocks
Bump damage. Cut if short on time
About 40 percent of space is empty void, so the map never feels cluttered and every POI stands out.

## Mechanics
Everything runs on one rule: your oxygen drains on your own clock. Every other mechanic changes how fast your clock ticks or where you can go.

### Flight
- 
Free flight in 3D. Thumbstick or WASD steers, a thrust button pushes forward, a brake button slows you.
- 
You keep your momentum. Let go of thrust and you drift. This is space: there is no friction except inside nebulae.
- 
Light speed in the game is 40 units per second, low enough that players actually get close to it.

### Your clock and oxygen
Each player has their own clock, shown big on the HUD. Oxygen drains in step with it. Every frame:
In words: the closer you are to something heavy (r near rs) or the faster you go (v near c), the slower your clock ticks. The star's countdown always runs on the mothership's clock, so it does not slow down for you.

### Gravity
Every heavy object pulls you toward it. We use a well-known approximation that gets the black hole's "point of no return" orbit right:
Far away this feels like normal gravity. Close to a black hole, orbits inside three times its size become unstable and you start to fall. Inside its horizon (r less than rs) nothing gets out.

### The speed limit
Thrust adds to your "proper speed" u, and your real speed is worked out from it:
So pushing always helps a little, but you can never reach c. Near light speed each push adds less and less.

### What other ships look like
Ships are tinted by how their clock compares to yours. A friend deep in a well looks red and slowed down. A friend racing toward you looks blue. This is real (gravitational and Doppler shift) and it is the main way players notice that time is different for different people.

### Tether and rescue
- 
Get within 6 units of a pod and hold the action button for 2 seconds to clip a tether.
- 
A tethered pod follows behind you and adds weight: you turn and speed up more slowly.
- 
Fly into the mothership's dock ring to deliver it.
- 
One ship tows one pod at a time. Two ships can share a tow to move it faster.
- 
The same tether rescues a teammate whose ship went dark.

### Death and respawn
- 
Oxygen out or three hull hits: your ship goes dark and drifts. A teammate can tow you home. Alone, you respawn at the mothership after 30 seconds of countdown.
- 
Crossing a horizon: instant loss. Respawn at the mothership. Any pod you were towing is lost.

## How it gets harder with more players
More pilots means more crew to save, but the countdown stays at 10 minutes, the sites move further out and sink deeper, and some rescues need two ships working together. Max 6 pilots per room.
Pilots
Crew lost
Countdown
Furthest site
Two-ship rescues
Black holes
1
2
10 min
3 chunks out
0
1
2
4
10 min
4 chunks out
1
1
3
6
10 min
5 chunks out
1
2
4
8
10 min
6 chunks out
2
2
5
10
10 min
7 chunks out
2
3
6
12
10 min
8 chunks out
3
3
The rule behind it: crew = 2 x pilots, countdown fixed, everything else creeps up. Each pilot always has about two rescues worth of work, but the trips get longer and the hard sites get harder.

### Two-ship rescues
These only appear with 2 or more pilots and can't be done alone.
- 
Anchor dive. A crewmate so deep in a black hole that no single ship can climb back out. One pilot hovers higher up as the anchor, the other dives on a long tether. The anchor's clock runs a little slow, the diver's runs very slow. When they come back, the two pilots' own clocks no longer match each other.
- 
Heavy pod. A big cargo pod with three crew inside, too heavy for one ship to tow out of a well. Two ships tether it together and have to fly in sync.

### Other things that change with more players
- 
Crew are placed so that at least half of them are more than one chunk apart. You can't win by flying as one group. Someone has to split off.
- 
Late joiners spawn at the mothership with full oxygen. The crew count is locked when the run starts, so joining late only helps.
- 
Teammates who go dark need towing home, so a bigger crew also means more people to rescue from your own side.

## The world
Space is endless and built from one seed, so every player's computer builds the exact same universe on its own. The server only sends the seed, the players and which crew are saved.

### Chunks
- 
Space is cut into cubes of 400 units a side. A chunk is named by its three grid numbers, like 3,-1,0.
- 
Each chunk's content comes from a hash of the run seed plus those three numbers. Same seed, same chunk, on every device.
- 
Around each player, the 5 x 5 x 5 block of chunks nearest them is built, closest first. Chunks that fall outside a 7 x 7 x 7 block are thrown away.
- 
Far away, every big object (stars, black holes) is also drawn as a dot on the sky, so you can always see where things are even before their chunk loads.

### How the map is laid out
- 
The centre (chunk 0,0,0): the dying star and the mothership. Always the same.
- 
The rescue ring: each crewmate's POI is placed at a fixed distance from the centre in a spread of directions, using the seed. The furthest one sits at the distance in the scaling table.
- 
Filler: every other chunk rolls from this table: empty void 40 percent, star 20, planet 15, nebula 10, extra black hole 5, extra dark matter 5, asteroid field 5.
- 
No dead ends: a filler roll is never allowed to block a straight line from the centre to a rescue site with a black hole.
Because the seed changes every run, the crew are in different places every time, but the kinds of rescue stay the same.

## What players see
The HUD is small and the clocks are big. If players only read one thing, it should be the clocks.
Where
What
Why
Top centre
Star countdown (mothership time)
The race against the explosion
Bottom left, large
Your own clock + oxygen ring
Your life. Glows cold blue when it's ticking slow, warm when normal
Bottom right
Each teammate's name and clock, ticking live
Seeing a friend's clock crawl or race is how the idea lands
Edges of screen
Arrows toward each distress beacon and the mothership
Direction only, never exact distance for crew
Under your ship
Speed as a bar that fills toward light speed
Shows the bar refusing to fill near the top
Near danger
Red edge glow near a horizon, beam warning near a pulsar
Warning without text
Thought bubbles: crewmates speak only when rescued, in short comic-style bubbles. Example after the first black hole rescue: "Wait. I've been gone two minutes. Why do you all look so tired?" Later rescues can be one line each. No narrator, no tutorial text.
Controls on phone: left thumbstick to steer, right side has three buttons: thrust, brake, tether. Same layout every run.

## Tech and build setup
A brand new repo and a brand new SpacetimeDB database. Nothing is cloned. Where Hacky already solved something, we paste only the specific lines we need and adapt them.

### Stack
Part
Choice
Client
Vite + React + TypeScript, React Three Fiber, three.js r185
Glow and gas
Spark (Gaussian splats for three.js) for nebulae, accretion discs, star surfaces
Backend
SpacetimeDB 2.9, TypeScript module, new database on Maincloud
Hosting
hacky.com (exact setup still to confirm)

### What we borrow from Hacky, line by line
Need
Taken from Hacky as a reference
Rooms, 6-character codes, QR join, join by link
Lobby flow and room code alphabet
One clean boundary between game and network
The net pattern: game code never touches the database SDK
Smooth remote ships
Send-on-change at 10 per second, exponential smoothing on the receiving side
Same universe on every device
Seeded hash and random number helpers
Black hole, star, pulsar look
Phenomena shaders and the sky dome's star bending
Bloom and colour
Post FX chain and quality tiers by device
Phone controls
Thumbstick and buttons behind one input component
The full map of what to take comes from the Hacky ecosystem briefing, which is still being written.

### Database tables
Table
Holds
room
Room code, host, phase (lobby, intro, playing, won, lost)
player
Identity, room, name, colour, connected
ship
Position, velocity, heading, own clock, oxygen, hull, status (flying, dark, home)
run
Seed, start time, countdown length, crew count, result
crew
Each lost crewmate: POI kind, chunk, status (lost, towed, home), who towed them, their clock
tether
Who is towing what
The countdown is worked out from the run's start time, so the server needs no ticking loop. Each client works out its own clock and reports it.

### Lessons we already paid for
- 
The module's entry file must re-export every file, or the reducers silently disappear on publish.
- 
All tables live in one schema file to avoid a load-order crash.
- 
Only ever add columns at the end. Changing or reordering a column wipes every live room.
- 
Always publish through the script that also regenerates the client bindings.

## Build order (4 to 5 hours)
Two people work side by side from a shared constants file, join their halves at 2:30, and stop adding features at 4:00.
If the 2:30 join takes longer than 20 minutes, both people fix it before anything else moves.

### Cut list, in this order if behind
- 
Asteroid field
- 
Runaway pod POI
- 
Wormhole travel (keep a teleport flash instead)
- 
Heavy pod two-ship rescue
- 
Splats (fall back to the existing shaders)
Never cut: your own clock, teammates' clocks on the HUD, the black hole rescue, the dark matter rescue, the opening event and the ending.