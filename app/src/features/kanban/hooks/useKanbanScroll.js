import { useEffect, useRef } from 'react';

// Pausa sem eventos de roda que encerra um gesto. A inércia da roda livre e do trackpad
// manda eventos seguidos por mais de 1s; só uma pausa real inicia um gesto novo.
export const WHEEL_GESTURE_IDLE_MS = 280;

export function createWheelGesture() {
  return { lastEventAt: -Infinity, lockedVertical: false };
}

// Decide para onde vai cada evento de roda:
// - 'vertical': a coluna sob o cursor ainda rola nessa direção (o navegador cuida);
// - 'hold': o gesto começou rolando a coluna e ela chegou ao fim; o restante do gesto é ignorado;
// - 'horizontal': o quadro rola para o lado.
export function resolveWheelIntent(gesture, { now, canScrollColumn }) {
  if (now - gesture.lastEventAt > WHEEL_GESTURE_IDLE_MS) gesture.lockedVertical = false;
  gesture.lastEventAt = now;
  if (canScrollColumn) {
    gesture.lockedVertical = true;
    return 'vertical';
  }
  return gesture.lockedVertical ? 'hold' : 'horizontal';
}

// Velocidade (px/s) da rolagem vertical de uma coluna durante o arraste de um card:
// negativa perto do topo, positiva perto da base, zero no meio ou fora da coluna.
export function verticalEdgeSpeed(rect, y, { edge = 72, min = 160, max = 900 } = {}) {
  if (y < rect.top || y > rect.bottom) return 0;
  const zone = Math.min(edge, (rect.bottom - rect.top) / 3);
  const fromTop = y - rect.top;
  const fromBottom = rect.bottom - y;
  if (fromTop >= zone && fromBottom >= zone) return 0;
  const toTop = fromTop < fromBottom;
  const ratio = 1 - Math.min(1, (toTop ? fromTop : fromBottom) / zone);
  const speed = min + (max - min) * ratio * ratio;
  return toTop ? -speed : speed;
}

export function useHorizontalMouseDragScroll(containerRef, { blockInteractiveTargets = false } = {}) {
  const dragStateRef = useRef({
    pointerId: null,
    startX: 0,
    startY: 0,
    initialScrollLeft: 0,
    dragging: false,
    suppressClick: false,
    suppressTimer: null,
    frameId: null,
    targetScrollLeft: 0,
    originalScrollBehavior: '',
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const state = dragStateRef.current;
    const interactiveSelector = 'button, a, input, textarea, select, [role="button"], [draggable="true"]';

    const flushScroll = () => {
      state.frameId = null;
      container.scrollLeft = state.targetScrollLeft;
    };

    const resetPointer = () => {
      const pointerId = state.pointerId;
      state.pointerId = null;
      if (pointerId !== null && container.hasPointerCapture?.(pointerId)) container.releasePointerCapture(pointerId);
      state.dragging = false;
      container.style.scrollBehavior = state.originalScrollBehavior;
      container.classList.remove('is-drag-scrolling');
    };

    const handlePointerDown = (event) => {
      const isPrimary = event.button === 0;
      const isMiddle = event.button === 1;
      if (event.pointerType !== 'mouse' || (!isPrimary && !isMiddle) || state.pointerId !== null) return;
      // A new press starts a new gesture. It must never inherit click
      // suppression left by a drag that did not emit a residual click.
      state.suppressClick = false;
      window.clearTimeout(state.suppressTimer);
      // Botão do meio permite rolar o quadro mesmo sobre cards arrastáveis; botão esquerdo respeita alvos interativos.
      if (isPrimary && blockInteractiveTargets && event.target.closest?.(interactiveSelector)) return;
      if (container.scrollWidth <= container.clientWidth) return;

      state.pointerId = event.pointerId;
      state.startX = event.clientX;
      state.startY = event.clientY;
      state.initialScrollLeft = container.scrollLeft;
      state.targetScrollLeft = container.scrollLeft;
      state.originalScrollBehavior = container.style.scrollBehavior;
      state.dragging = false;
      if (isMiddle) event.preventDefault();
      // O corpo do card rola o quadro e não recebe foco por clique do mouse.
      if (event.target.closest?.('.kanban-card')) event.preventDefault();
    };

    const handlePointerMove = (event) => {
      if (event.pointerId !== state.pointerId) return;
      const deltaX = event.clientX - state.startX;

      if (!state.dragging) {
        const deltaY = event.clientY - state.startY;
        if (Math.abs(deltaY) >= 6 && Math.abs(deltaY) > Math.abs(deltaX)) {
          resetPointer();
          return;
        }
        if (Math.abs(deltaX) < 6) return;
        state.dragging = true;
        container.setPointerCapture?.(event.pointerId);
        container.style.scrollBehavior = 'auto';
        container.classList.add('is-drag-scrolling');
      }

      event.preventDefault();
      state.targetScrollLeft = state.initialScrollLeft - deltaX;
      if (state.frameId === null) state.frameId = window.requestAnimationFrame(flushScroll);
    };

    const handlePointerEnd = (event) => {
      if (event.pointerId !== state.pointerId) return;
      const dragged = state.dragging;
      if (state.frameId !== null) {
        window.cancelAnimationFrame(state.frameId);
        flushScroll();
      }
      resetPointer();

      if (dragged) {
        state.suppressClick = true;
        window.clearTimeout(state.suppressTimer);
        state.suppressTimer = window.setTimeout(() => {
          state.suppressClick = false;
        }, 350);
      }
    };

    const handleClickCapture = (event) => {
      if (!state.suppressClick || event.detail === 0) return;
      state.suppressClick = false;
      window.clearTimeout(state.suppressTimer);
      event.preventDefault();
      event.stopPropagation();
    };

    container.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);
    container.addEventListener('lostpointercapture', handlePointerEnd);
    container.addEventListener('click', handleClickCapture, true);

    return () => {
      window.clearTimeout(state.suppressTimer);
      if (state.frameId !== null) {
        window.cancelAnimationFrame(state.frameId);
        state.frameId = null;
      }
      resetPointer();
      container.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
      container.removeEventListener('lostpointercapture', handlePointerEnd);
      container.removeEventListener('click', handleClickCapture, true);
    };
  }, [containerRef, blockInteractiveTargets]);
}

export function useKanbanDragAutoScroll(containerRef, isDragging, onColumnHover) {
  const scrollStateRef = useRef({
    frameId: null,
    speed: 0,
    // Rolagem vertical da coluna sob o cursor (arrastar perto do topo ou da base).
    vSpeed: 0,
    vContainer: null,
    originalScrollBehavior: null,
    lastCoords: null,
    lastHoveredColId: null,
  });

  useEffect(() => {
    if (!isDragging) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    const state = scrollStateRef.current;
    const EDGE_ZONE = 110;
    // Velocidades em px/s para comportamento idêntico em 60Hz, 120Hz e 144Hz.
    const MIN_SPEED_PX_S = 180;
    const MAX_SPEED_PX_S = 1100;
    const HIT_TEST_INTERVAL_MS = 80;
    let lastFrameTime = 0;
    let lastHitTestTime = 0;

    const stopLoop = () => {
      state.speed = 0;
      state.vSpeed = 0;
      state.vContainer = null;
      lastFrameTime = 0;
      if (state.frameId !== null) {
        window.cancelAnimationFrame(state.frameId);
        state.frameId = null;
      }
      if (state.originalScrollBehavior !== null) {
        container.style.scrollBehavior = state.originalScrollBehavior;
        state.originalScrollBehavior = null;
      }
    };

    const scrollStep = (timestamp) => {
      const currentContainer = containerRef.current;
      if (!currentContainer || (state.speed === 0 && state.vSpeed === 0)) {
        state.frameId = null;
        lastFrameTime = 0;
        return;
      }

      const dt = lastFrameTime ? Math.min(0.05, Math.max(0.004, (timestamp - lastFrameTime) / 1000)) : 1 / 60;
      lastFrameTime = timestamp;

      const maxScroll = Math.max(0, currentContainer.scrollWidth - currentContainer.clientWidth);
      const currentScroll = currentContainer.scrollLeft;
      const step = state.speed * dt;

      let didScroll = false;
      if (step > 0 && currentScroll < maxScroll) {
        currentContainer.scrollLeft = Math.min(maxScroll, currentScroll + step);
        didScroll = true;
      } else if (step < 0 && currentScroll > 0) {
        currentContainer.scrollLeft = Math.max(0, currentScroll + step);
        didScroll = true;
      }

      // Eixo vertical: rola a lista de cards da coluna sob o cursor.
      let didScrollVertical = false;
      const column = state.vContainer;
      if (column && state.vSpeed !== 0 && column.isConnected) {
        const maxTop = Math.max(0, column.scrollHeight - column.clientHeight);
        const top = column.scrollTop;
        const vStep = state.vSpeed * dt;
        if ((vStep > 0 && top < maxTop) || (vStep < 0 && top > 0)) {
          column.scrollTop = Math.max(0, Math.min(maxTop, top + vStep));
          didScrollVertical = true;
        }
      }

      // Atualiza a coluna sob o cursor com throttle para evitar hit-test síncrono a cada frame.
      if (
        didScroll
        && state.lastCoords
        && typeof onColumnHover === 'function'
        && (timestamp - lastHitTestTime >= HIT_TEST_INTERVAL_MS)
      ) {
        lastHitTestTime = timestamp;
        const el = document.elementFromPoint(state.lastCoords.x, state.lastCoords.y);
        const colEl = el?.closest?.('.kanban-column');
        if (colEl) {
          const colId = colEl.getAttribute('data-column-id');
          if (colId && colId !== state.lastHoveredColId) {
            state.lastHoveredColId = colId;
            onColumnHover(colId);
          }
        } else if (state.lastHoveredColId !== null) {
          state.lastHoveredColId = null;
          onColumnHover(null);
        }
      }

      if (didScroll || didScrollVertical) {
        state.frameId = window.requestAnimationFrame(scrollStep);
      } else {
        state.frameId = null;
        lastFrameTime = 0;
      }
    };

    const startLoop = () => {
      if (state.frameId === null) {
        if (state.originalScrollBehavior === null) {
          state.originalScrollBehavior = container.style.scrollBehavior;
        }
        container.style.scrollBehavior = 'auto';
        lastFrameTime = 0;
        state.frameId = window.requestAnimationFrame(scrollStep);
      }
    };

    const handleWindowDragOver = (event) => {
      const currentContainer = containerRef.current;
      if (!currentContainer) return;

      const rect = currentContainer.getBoundingClientRect();
      const x = event.clientX;
      const y = event.clientY;
      state.lastCoords = { x, y };

      // Se o cursor estiver fora dos limites verticais do Kanban (+/- 60px de tolerância), para o auto-scroll
      if (y < rect.top - 60 || y > rect.bottom + 60) {
        stopLoop();
        return;
      }

      // Zona de auto-scroll à esquerda
      if (x < rect.left + EDGE_ZONE && x >= rect.left - 50) {
        const dist = Math.max(0, x - rect.left);
        const ratio = 1 - Math.min(1, dist / EDGE_ZONE);
        const eased = ratio * ratio;
        state.speed = -(MIN_SPEED_PX_S + (MAX_SPEED_PX_S - MIN_SPEED_PX_S) * eased);
      }
      // Zona de auto-scroll à direita
      else if (x > rect.right - EDGE_ZONE && x <= rect.right + 50) {
        const dist = Math.max(0, rect.right - x);
        const ratio = 1 - Math.min(1, dist / EDGE_ZONE);
        const eased = ratio * ratio;
        state.speed = MIN_SPEED_PX_S + (MAX_SPEED_PX_S - MIN_SPEED_PX_S) * eased;
      }
      // Fora das zonas de borda
      else {
        state.speed = 0;
      }

      // Topo ou base da lista de cards da coluna sob o cursor
      const cards = event.target?.closest?.('.kanban-column')?.querySelector?.('.column-cards-container');
      state.vSpeed = cards ? verticalEdgeSpeed(cards.getBoundingClientRect(), y) : 0;
      state.vContainer = state.vSpeed !== 0 ? cards : null;

      if (state.speed !== 0 || state.vSpeed !== 0) startLoop();
      else stopLoop();
    };

    const handleDragEndOrDrop = () => {
      stopLoop();
      state.lastCoords = null;
      state.lastHoveredColId = null;
    };

    window.addEventListener('dragover', handleWindowDragOver, { passive: true });
    window.addEventListener('dragend', handleDragEndOrDrop);
    window.addEventListener('drop', handleDragEndOrDrop);

    return () => {
      stopLoop();
      state.lastCoords = null;
      state.lastHoveredColId = null;
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('dragend', handleDragEndOrDrop);
      window.removeEventListener('drop', handleDragEndOrDrop);
    };
  }, [containerRef, isDragging, onColumnHover]);
}

export function useKanbanWheelScroll(containerRef) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const gesture = createWheelGesture();
    let frameId = null;
    let lastFrameTime = 0;
    let currentPos = container.scrollLeft;
    let targetPos = container.scrollLeft;

    const cancelAnimation = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
        frameId = null;
      }
      lastFrameTime = 0;
    };

    const animateScroll = (timestamp) => {
      const dt = lastFrameTime ? Math.min(0.05, Math.max(0.004, (timestamp - lastFrameTime) / 1000)) : 1 / 60;
      lastFrameTime = timestamp;

      // Interpolação exponencial independente da taxa de atualização (60Hz / 120Hz / 144Hz).
      const factor = 1 - Math.exp(-18 * dt);
      const diff = targetPos - currentPos;

      if (Math.abs(diff) <= 0.6) {
        container.scrollLeft = targetPos;
        currentPos = targetPos;
        frameId = null;
        lastFrameTime = 0;
        return;
      }

      currentPos += diff * factor;
      container.scrollLeft = currentPos;
      frameId = window.requestAnimationFrame(animateScroll);
    };

    const handleWheel = (event) => {
      if (event.defaultPrevented) return;

      // Se o scroll horizontal nativo for predominante (ex: trackpad com gesto horizontal), deixa o navegador agir
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        cancelAnimation();
        return;
      }

      // Coluna sob o cursor que ainda rola na direção do giro: a rolagem vertical é do navegador.
      // Um gesto que começou na coluna fica nela até a roda parar (sem escorregar para o lado no fim).
      const cardsContainer = event.shiftKey ? null : event.target?.closest?.('.column-cards-container');
      let canScrollColumn = false;
      if (cardsContainer && cardsContainer.scrollHeight - cardsContainer.clientHeight > 3) {
        canScrollColumn = event.deltaY > 0
          ? cardsContainer.scrollTop + cardsContainer.clientHeight < cardsContainer.scrollHeight - 3
          : event.deltaY < 0 && cardsContainer.scrollTop > 3;
      }
      if (resolveWheelIntent(gesture, { now: event.timeStamp, canScrollColumn }) !== 'horizontal') return;

      // Normalização do delta proporcional ao deltaMode
      let delta = event.deltaY;
      if (event.deltaMode === 1) {
        // DOM_DELTA_LINE (típico de roda de mouse no Windows)
        delta *= 32;
      } else if (event.deltaMode === 2) {
        // DOM_DELTA_PAGE
        delta *= container.clientWidth * 0.8;
      }

      const clampedDelta = Math.max(-220, Math.min(220, delta));
      if (clampedDelta === 0) return;

      const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);
      if (maxScroll <= 0) return;

      // Sincroniza posição inicial caso o scroll tenha sido movido por fora (atalho, scrollbar ou drag)
      if (frameId === null) {
        currentPos = container.scrollLeft;
        targetPos = currentPos;
      }

      const nextTarget = Math.max(0, Math.min(maxScroll, targetPos + clampedDelta));
      if (nextTarget === targetPos) return;

      // Ouvinte passivo: sem preventDefault. O quadro tem overflow-y oculto e
      // overscroll-behavior: contain, então a roda vertical não rola a página junto.
      targetPos = nextTarget;

      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (reduceMotion) {
        currentPos = targetPos;
        container.scrollLeft = targetPos;
        return;
      }

      if (frameId === null) {
        lastFrameTime = 0;
        frameId = window.requestAnimationFrame(animateScroll);
      }
    };

    // Passivo: a coluna sob o cursor rola direto no compositor, sem esperar o JavaScript.
    container.addEventListener('wheel', handleWheel, { passive: true });
    container.addEventListener('pointerdown', cancelAnimation, { passive: true });

    return () => {
      cancelAnimation();
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('pointerdown', cancelAnimation);
    };
  }, [containerRef]);
}

