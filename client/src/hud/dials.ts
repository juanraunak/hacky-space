// Two analog clocks side by side, the clearest way to SEE time running at
// different speeds: yours, and the mothership's (or a pod's). The second
// hand of a slow clock visibly crawls. Shared by the cockpit dashboard and
// the HUD.

export interface Dial { label: string; seconds: number; rate: number; color: string }

export function drawDials(ctx: CanvasRenderingContext2D, w: number, h: number, dials: Dial[]) {
  ctx.clearRect(0, 0, w, h);
  const n = dials.length;
  const r = Math.min(h * 0.36, (w / n) * 0.38);
  dials.forEach((d, i) => {
    const cx = (w / n) * (i + 0.5), cy = h * 0.44;
    // face
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(6, 10, 20, 0.75)'; ctx.fill();
    ctx.lineWidth = r * 0.05; ctx.strokeStyle = d.color; ctx.stroke();
    for (let k = 0; k < 60; k++) {
      const a = (k / 60) * Math.PI * 2, big = k % 5 === 0;
      const r0 = r * (big ? 0.78 : 0.86), r1 = r * 0.92;
      ctx.beginPath(); ctx.moveTo(cx + Math.sin(a) * r0, cy - Math.cos(a) * r0); ctx.lineTo(cx + Math.sin(a) * r1, cy - Math.cos(a) * r1);
      ctx.lineWidth = big ? r * 0.035 : r * 0.015; ctx.strokeStyle = 'rgba(232,236,255,0.7)'; ctx.stroke();
    }
    // minute hand
    const m = ((d.seconds / 60) % 60) / 60 * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(m) * r * 0.5, cy - Math.cos(m) * r * 0.5);
    ctx.lineWidth = r * 0.06; ctx.lineCap = 'round'; ctx.strokeStyle = '#e8ecff'; ctx.stroke();
    // second hand: moves at this clock's own rate
    const s = ((d.seconds % 60) / 60) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(s) * r * 0.84, cy - Math.cos(s) * r * 0.84);
    ctx.lineWidth = r * 0.025; ctx.strokeStyle = d.color; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.05, 0, Math.PI * 2); ctx.fillStyle = d.color; ctx.fill();
    // labels
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8ecff';
    ctx.font = `600 ${Math.round(r * 0.22)}px 'Space Grotesk', system-ui, sans-serif`;
    const mm = Math.floor(d.seconds / 60), ss = Math.floor(d.seconds % 60);
    ctx.fillText(`${mm}:${String(ss).padStart(2, '0')}`, cx, cy + r * 0.45);
    ctx.font = `600 ${Math.round(r * 0.2)}px 'Space Grotesk', system-ui, sans-serif`;
    ctx.fillStyle = d.color;
    ctx.fillText(d.label, cx, cy + r + r * 0.3);
    ctx.fillStyle = 'rgba(232,236,255,0.75)';
    ctx.font = `${Math.round(r * 0.17)}px 'Space Grotesk', system-ui, sans-serif`;
    ctx.fillText(d.rate >= 0.995 ? 'normal speed' : `${Math.round(d.rate * 100)}% speed`, cx, cy + r + r * 0.55);
  });
}
