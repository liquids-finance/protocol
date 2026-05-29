/**
 * Sky scene background — gradient sky + two angled brand stripes.
 * Pure CSS, fixed-position behind everything. No JS interaction needed.
 */
export function SceneBackground() {
  return (
    <div className="scene" aria-hidden>
      <div className="scene-sky" />
      <div className="scene-stripe scene-stripe-a" />
      <div className="scene-stripe scene-stripe-b" />
    </div>
  );
}
