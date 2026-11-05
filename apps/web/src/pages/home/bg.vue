<template>
  <div ref="wrapperRef" class="dotGrid" aria-hidden="true">
    <canvas ref="canvasRef" />
  </div>
</template>

<script setup lang="ts">
import { gsap } from "gsap";
import { InertiaPlugin } from "gsap/InertiaPlugin";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

gsap.registerPlugin(InertiaPlugin);

interface Dot {
  cx: number;
  cy: number;
  xOffset: number;
  yOffset: number;
  inertiaApplied: boolean;
}
interface DotGridProps {
  dotSize?: number;
  gap?: number;
  baseColor?: string;
  activeColor?: string;
  proximity?: number;
  speedTrigger?: number;
  shockRadius?: number;
  shockStrength?: number;
  maxSpeed?: number;
  resistance?: number;
  returnDuration?: number;
}
const props = withDefaults(defineProps<DotGridProps>(), {
  dotSize: 3, gap: 23, proximity: 150, speedTrigger: 100,
  shockRadius: 180, shockStrength: 2, maxSpeed: 5000,
  resistance: 750, returnDuration: 1.5,
});
const wrapperRef = ref<HTMLDivElement>();
const canvasRef = ref<HTMLCanvasElement>();
let dots: Dot[] = [];
let context: CanvasRenderingContext2D | null = null;
let width = 0;
let height = 0;
let raf = 0;
let alive = false;
let visible = true;
let lastMove = 0;
let baseRgb = [0, 0, 0];
let activeRgb = [0, 0, 0];
let baseColor = "";
let resizeObserver: ResizeObserver;
let themeObserver: MutationObserver;
let intersectionObserver: IntersectionObserver;
let reducedMotion: MediaQueryList;
const events = new AbortController();
const pointer = { x: -1000, y: -1000, lastX: 0, lastY: 0, lastTime: 0, tracked: false };

function parseColor(value: string): number[] {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
}
function updateColors() {
  if (!wrapperRef.value) return;
  const styles = getComputedStyle(wrapperRef.value);
  baseColor = props.baseColor || styles.getPropertyValue("--dotBase").trim();
  baseRgb = parseColor(baseColor);
  activeRgb = parseColor(props.activeColor || styles.getPropertyValue("--dotActive").trim());
  wake();
}
function stopTweens() {
  dots.forEach(dot => gsap.killTweensOf(dot));
}
function buildGrid() {
  const wrap = wrapperRef.value;
  const canvas = canvasRef.value;
  if (!wrap || !canvas || !context) return;
  stopTweens();
  width = wrap.clientWidth;
  height = wrap.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  const size = Math.max(1, props.dotSize);
  const gap = Math.max(2, props.gap);
  const cell = size + gap;
  const cols = Math.floor((width + gap) / cell);
  const rows = Math.floor((height + gap) / cell);
  const startX = (width - (cell * cols - gap)) / 2 + size / 2;
  const startY = (height - (cell * rows - gap)) / 2 + size / 2;
  dots = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      dots.push({ cx: startX + x * cell, cy: startY + y * cell, xOffset: 0, yOffset: 0, inertiaApplied: false });
    }
  }
  resetPointer();
  wake();
}
function draw() {
  raf = 0;
  if (!alive || !visible || document.hidden || !context) return;
  context.clearRect(0, 0, width, height);
  const proximity = Math.max(1, props.proximity);
  let moving = false;
  for (const dot of dots) {
    const distance = Math.hypot(dot.cx - pointer.x, dot.cy - pointer.y);
    const blend = reducedMotion.matches ? 0 : Math.max(0, 1 - distance / proximity);
    context.fillStyle = blend ? `rgb(${baseRgb.map((value, index) => Math.round(value + (activeRgb[index]! - value) * blend)).join(",")})` : baseColor;
    context.beginPath();
    context.arc(dot.cx + dot.xOffset, dot.cy + dot.yOffset, Math.max(1, props.dotSize) / 2, 0, Math.PI * 2);
    context.fill();
    moving ||= dot.inertiaApplied || gsap.isTweening(dot);
  }
  if (moving && !reducedMotion.matches) raf = requestAnimationFrame(draw);
}
function wake() {
  if (alive && visible && !document.hidden && !raf) raf = requestAnimationFrame(draw);
}
function animateDot(dot: Dot, x: number, y: number) {
  if (dot.inertiaApplied) return;
  dot.inertiaApplied = true;
  gsap.killTweensOf(dot);
  gsap.to(dot, {
    inertia: { xOffset: x, yOffset: y, resistance: Math.max(1, props.resistance) },
    onComplete: () => {
      gsap.to(dot, {
        xOffset: 0, yOffset: 0, duration: Math.max(0.1, props.returnDuration),
        ease: "elastic.out(1,0.75)",
        onComplete: () => { dot.inertiaApplied = false; wake(); },
      });
      wake();
    },
  });
  wake();
}
function locate(event: PointerEvent) {
  const rect = wrapperRef.value!.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  return { x, y, inside: x >= 0 && y >= 0 && x <= rect.width && y <= rect.height };
}
function resetPointer() {
  pointer.x = pointer.y = -1000;
  pointer.tracked = false;
  wake();
}
function onMove(event: PointerEvent) {
  if (!visible || document.hidden || reducedMotion.matches || event.pointerType === "touch") return;
  const now = performance.now();
  if (now - lastMove < 32) return;
  lastMove = now;
  const spot = locate(event);
  if (!spot.inside) { resetPointer(); return; }
  const dt = Math.max(1, now - pointer.lastTime);
  let vx = pointer.tracked ? (event.clientX - pointer.lastX) / dt * 1000 : 0;
  let vy = pointer.tracked ? (event.clientY - pointer.lastY) / dt * 1000 : 0;
  const speed = Math.hypot(vx, vy);
  const scale = Math.min(1, Math.max(0, props.maxSpeed) / Math.max(1, speed));
  vx *= scale;
  vy *= scale;
  Object.assign(pointer, { x: spot.x, y: spot.y, lastX: event.clientX, lastY: event.clientY, lastTime: now, tracked: true });
  if (speed * scale > props.speedTrigger) {
    for (const dot of dots) {
      if (Math.hypot(dot.cx - spot.x, dot.cy - spot.y) < props.proximity) {
        animateDot(dot, dot.cx - spot.x + vx * 0.005, dot.cy - spot.y + vy * 0.005);
      }
    }
  }
  wake();
}
function onClick(event: PointerEvent) {
  if (!visible || document.hidden || reducedMotion.matches) return;
  const spot = locate(event);
  if (!spot.inside) return;
  const radius = Math.max(1, props.shockRadius);
  for (const dot of dots) {
    const distance = Math.hypot(dot.cx - spot.x, dot.cy - spot.y);
    if (distance >= radius) continue;
    const force = Math.max(0, props.shockStrength) * (1 - distance / radius);
    animateDot(dot, (dot.cx - spot.x) * force, (dot.cy - spot.y) * force);
  }
}
function syncMotion() {
  cancelAnimationFrame(raf);
  raf = 0;
  stopTweens();
  dots.forEach(dot => { dot.xOffset = 0; dot.yOffset = 0; dot.inertiaApplied = false; });
  resetPointer();
}

onMounted(() => {
  context = canvasRef.value!.getContext("2d");
  if (!context) return;
  alive = true;
  reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  updateColors();
  buildGrid();
  resizeObserver = new ResizeObserver(buildGrid);
  resizeObserver.observe(wrapperRef.value!);
  themeObserver = new MutationObserver(updateColors);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
  intersectionObserver = new IntersectionObserver(entries => {
    visible = entries[0]?.isIntersecting ?? false;
    syncMotion();
  });
  intersectionObserver.observe(wrapperRef.value!);
  const options = { passive: true, signal: events.signal };
  window.addEventListener("pointermove", onMove, options);
  window.addEventListener("pointerdown", onClick, options);
  window.addEventListener("blur", resetPointer, options);
  window.addEventListener("pointerout", event => { if (!event.relatedTarget) resetPointer(); }, options);
  document.addEventListener("visibilitychange", syncMotion, options);
  reducedMotion.addEventListener("change", syncMotion, options);
});
watch(() => [props.dotSize, props.gap], buildGrid);
watch(() => [props.baseColor, props.activeColor], updateColors);
onBeforeUnmount(() => {
  alive = false;
  events.abort();
  cancelAnimationFrame(raf);
  stopTweens();
  resizeObserver?.disconnect();
  themeObserver?.disconnect();
  intersectionObserver?.disconnect();
});
</script>

<style lang="scss" scoped>
.dotGrid {
  --dotBase: #c5d2cc;
  --dotActive: #658c7b;
  position: relative;
  overflow: hidden;
  pointer-events: none;

  :global(.dark) & {
    --dotBase: #3b5148;
    --dotActive: #91c8ac;
  }

  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
}
</style>
