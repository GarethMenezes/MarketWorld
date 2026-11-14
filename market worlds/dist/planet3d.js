/*
 * Planet3D browser adaptation
 * Copyright (c) 2023 Ishan Oshada. MIT licence: ./licenses/Planet3D.txt
 * Original: https://github.com/Ishanoshada/Planet3D
 * Source commit: 601ac0a26b895ab67da8873d8015f8526bc7f1c7
 *
 * Ports Planet/Moon properties, parent-relative moon hierarchy, add_ring,
 * add_moon, circular orbit positions and angle updates from Python.
 * The realtime-planet-shader adapter renders this model in WebGL 2.
 * Added elapsed-time motion and independently orbiting moons.
 */
(function (global) {
  "use strict";
  const radians = degrees => degrees * Math.PI / 180;
  class Planet {
    constructor(name, radius, orbit_radius, rotation_speed, color) {
      Object.assign(this, { name, radius, orbit_radius, rotation_speed, color });
      this.angle = 0;
      this.rings = null;
      this.moons = [];
    }
    position() {
      return [this.orbit_radius * Math.cos(radians(this.angle)), 0,
        this.orbit_radius * Math.sin(radians(this.angle))];
    }
    update(seconds) {
      // Upstream advanced by rotation_speed each frame at 30 fps.
      this.angle = (this.angle + this.rotation_speed * seconds * 30) % 360;
      this.moons.forEach(moon => moon.update(seconds));
    }
    add_ring(radius, width, color, transparency) {
      this.rings = { radius, width, color, transparency };
      return this.rings;
    }
    add_moon(name, radius, orbit_radius, rotation_speed, color) {
      const moon = new Moon(name, radius, orbit_radius, rotation_speed, color);
      this.moons.push(moon);
      return moon;
    }
  }
  class Moon extends Planet {}

  global.Planet3D={Planet,Moon};
})(window);
