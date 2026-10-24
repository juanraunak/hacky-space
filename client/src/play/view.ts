// Which camera: driving from behind the ship, or sitting in the cockpit.
export const view = {
  mode: (() => { try { return localStorage.getItem('hackyspace.view') === 'cockpit' ? 'cockpit' : 'chase'; } catch { return 'chase'; } })() as 'chase' | 'cockpit',
};
export function toggleView() {
  view.mode = view.mode === 'chase' ? 'cockpit' : 'chase';
  try { localStorage.setItem('hackyspace.view', view.mode); } catch { /* fine */ }
}
