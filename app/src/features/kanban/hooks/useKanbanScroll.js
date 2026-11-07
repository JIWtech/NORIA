import { useEffect, useRef } from 'react';

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
      if (event.pointerType !== 'mouse' || event.button !== 0 || state.pointerId !== null) return;
      // A new press starts a new gesture. It must never inherit click
      // suppression left by a drag that did not emit a residual click.
      state.suppressClick = false;
      window.clearTimeout(state.suppressTimer);
      if (blockInteractiveTargets && event.target.closest?.(interactiveSelector)) return;
      if (container.scrollWidth <= container.clientWidth) return;

      state.pointerId = event.pointerId;
      state.startX = event.clientX;
      state.startY = event.clientY;
      state.initialScrollLeft = container.scrollLeft;
      state.targetScrollLeft = container.scrollLeft;
      state.originalScrollBehavior = container.style.scrollBehavior;
      state.dragging = false;
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
    const MIN_SPEED = 2.5;
    const MAX_SPEED = 18;

    const stopLoop = () => {
      state.speed = 0;
      if (state.frameId !== null) {
        window.cancelAnimationFrame(state.frameId);
        state.frameId = null;
      }
      if (state.originalScrollBehavior !== null) {
        container.style.scrollBehavior = state.originalScrollBehavior;
        state.originalScrollBehavior = null;
      }
    };

    const scrollStep = () => {
      const currentContainer = containerRef.current;
      if (!currentContainer || state.speed === 0) {
        state.frameId = null;
        return;
      }

      const maxScroll = Math.max(0, currentContainer.scrollWidth - currentContainer.clientWidth);
      const currentScroll = currentContainer.scrollLeft;
      const speed = state.speed;

      let didScroll = false;
      if (speed > 0 && currentScroll < maxScroll) {
        currentContainer.scrollLeft = Math.min(maxScroll, currentScroll + speed);
        didScroll = true;
      } else if (speed < 0 && currentScroll > 0) {
        currentContainer.scrollLeft = Math.max(0, currentScroll + speed);
        didScroll = true;
      }

      // Se moveu o scroll e temos coordenadas do cursor, atualiza a coluna sob o cursor
      if (didScroll && state.lastCoords && typeof onColumnHover === 'function') {
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

      if (didScroll) {
        state.frameId = window.requestAnimationFrame(scrollStep);
      } else {
        state.frameId = null;
      }
    };

    const startLoop = () => {
      if (state.frameId === null) {
        if (state.originalScrollBehavior === null) {
          state.originalScrollBehavior = container.style.scrollBehavior;
        }
        container.style.scrollBehavior = 'auto';
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
        state.speed = -(MIN_SPEED + (MAX_SPEED - MIN_SPEED) * eased);
        startLoop();
      }
      // Zona de auto-scroll à direita
      else if (x > rect.right - EDGE_ZONE && x <= rect.right + 50) {
        const dist = Math.max(0, rect.right - x);
        const ratio = 1 - Math.min(1, dist / EDGE_ZONE);
        const eased = ratio * ratio;
        state.speed = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * eased;
        startLoop();
      }
      // Fora das zonas de borda
      else {
        stopLoop();
      }
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

    let lastVerticalScrollTime = 0;
    let restoreTimer = null;

    const handleWheel = (event) => {
      if (event.defaultPrevented) return;

      // Se o scroll horizontal nativo for predominante (ex: trackpad com gesto horizontal), deixa o navegador agir
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        return;
      }

      // Analisa a hierarquia para verificar se o cursor está sobre uma lista vertical de cards
      const target = event.target;
      const cardsContainer = target?.closest?.('.column-cards-container');

      if (cardsContainer) {
        const scrollableDistance = cardsContainer.scrollHeight - cardsContainer.clientHeight;
        const hasVerticalScroll = scrollableDistance > 3;

        // Se a coluna possui scroll vertical e o usuário não estiver segurando Shift (padrão para forçar horizontal)
        if (hasVerticalScroll && !event.shiftKey) {
          const isScrollingDown = event.deltaY > 0;
          const isScrollingUp = event.deltaY < 0;
          const isAtBottom = cardsContainer.scrollTop + cardsContainer.clientHeight >= cardsContainer.scrollHeight - 3;
          const isAtTop = cardsContainer.scrollTop <= 3;

          // Se há espaço para rolar verticalmente na direção do wheel, preserva o scroll vertical dos cards
          if ((isScrollingDown && !isAtBottom) || (isScrollingUp && !isAtTop)) {
            lastVerticalScrollTime = Date.now();
            return;
          }

          // Se acabou de rolar verticalmente (nos últimos 180ms), amortece o final da rolagem
          // para não disparar um salto horizontal repentino no mesmo gesto contínuo
          if (Date.now() - lastVerticalScrollTime < 180) {
            return;
          }
        }
      }

      // Normalização do delta proporcional ao deltaMode
      let delta = event.deltaY;
      if (event.deltaMode === 1) {
        // DOM_DELTA_LINE (típico de roda de mouse no Windows)
        delta *= 30;
      } else if (event.deltaMode === 2) {
        // DOM_DELTA_PAGE
        delta *= container.clientWidth * 0.8;
      }

      // Limita a velocidade por tick para evitar saltos bruscos
      const clampedDelta = Math.max(-160, Math.min(160, delta));
      if (clampedDelta === 0) return;

      const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);
      if (maxScroll <= 0) return;

      const currentScroll = container.scrollLeft;
      const targetScroll = Math.max(0, Math.min(maxScroll, currentScroll + clampedDelta));

      // Impede o scroll vertical da página principal (body)
      event.preventDefault();

      if (targetScroll !== currentScroll) {
        if (container.style.scrollBehavior !== 'auto') {
          container.style.scrollBehavior = 'auto';
        }
        container.scrollLeft = targetScroll;

        window.clearTimeout(restoreTimer);
        restoreTimer = window.setTimeout(() => {
          if (container) container.style.scrollBehavior = '';
        }, 150);
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      window.clearTimeout(restoreTimer);
      container.removeEventListener('wheel', handleWheel);
    };
  }, [containerRef]);
}

