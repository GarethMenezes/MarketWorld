// Invisible continent meshes must not mask visible company geometry.
export function choosePickHit(hits, groundDistance) {
  const visible = hits.filter(({ object, distance }) => object.visible
    && (!object.userData.companyMesh || object.userData.companyMesh.visible)
    && (object.userData.marketId || distance <= groundDistance + 0.15));
  return visible.find((h) => h.object.userData.ticker)
    ?? visible.find((h) => h.object.userData.crater)
    ?? visible[0];
}
