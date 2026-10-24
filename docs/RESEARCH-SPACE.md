# How to make space beautiful (research brief, 24 Oct 2026)

Sources: Smaller than Pixels (EG 2025), Gaia Sky star rendering, wwwtyro/space-3d
(Unlicense), SpaceEngine blog, DNGR / Interstellar (James et al. 2015), NASA SVS
(Schnittman), MIT OpenRelativity (MIT licence), Elite Dangerous Stellar Forge.

Top changes, in order:
1. Stars: 6-8k points desktop, 3k phone. Magnitudes exponential (x2.5 per mag);
   only the brightest ~1% get >= 3 px. Colour from B-V (75% K/M, 20% F/G, 5% O/B),
   desaturated 50% toward white. No twinkle. Gaussian PSF sigma ~0.8 px.
2. Milky Way band baked into the cubemap: Gaussian in latitude (sigma ~8 deg),
   3x bulge toward the centre, warm yellow-white, brown-black dust lanes
   (40-60%), nebula saturation < 0.35 and luminance < 0.15.
3. AgX tone mapping, exposure 0.8-1.0, stars up to ~20 in HDR. Gentle auto
   exposure (clamp 0.4-1.5); fixed exposure in cutscenes.
4. Bloom: mipmap blur, threshold 1.0, strength 0.5-0.7 desktop, 0.35 phone.
   Optional faint wide veiling glare (~4%).
5. Ship light: key from the nearest star (its colour), rim from behind at 40%,
   fill hemisphere 0.03-0.05, near-black shadows.
6. Depth: few dust motes, fog only inside nebulae, stars at infinity.
7. Black hole: disc ~4500 K, approaching side 1.3-1.8x brighter (damped),
   thin photon ring at the shadow edge, slow camera orbit. Pulsar: thin tilted
   additive cones + hot core. Wormhole: refract the starfield, faint bright rim.
8. Phones: cubemap 512, 3k stars, half-res bloom, DPR cap 1.5.
