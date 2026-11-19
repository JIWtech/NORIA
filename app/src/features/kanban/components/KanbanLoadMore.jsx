import React, { useEffect, useRef } from 'react';

// Fim de uma coluna grande do Kanban: carrega a próxima página de cards quando aparece na tela (rolagem da coluna).
// O botão continua disponível para teclado e navegadores sem IntersectionObserver.
export function KanbanLoadMore({ hidden, pageSize, onLoadMore }) {
  const sentinel = useRef(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || hidden <= 0 || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
    }, { rootMargin: '300px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hidden, onLoadMore]);
  if (hidden <= 0) return null;
  return (
    <button ref={sentinel} type="button" className="secondary-button kanban-show-more" onClick={onLoadMore}>
      Mostrar mais {Math.min(hidden, pageSize)} de {hidden}
    </button>
  );
}
