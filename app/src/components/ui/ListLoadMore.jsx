import React, { useEffect, useRef } from 'react';

// Sentinela reutilizável para listas paginadas: carrega a próxima página ao entrar na viewport
// e mantém o botão acessível como fallback para teclado ou ambientes sem IntersectionObserver.
export function ListLoadMore({ hidden, pageSize, onLoadMore, className = 'secondary-button list-show-more', rootMargin = '300px' }) {
  const sentinel = useRef(null);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || hidden <= 0 || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
    }, { rootMargin });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hidden, onLoadMore, rootMargin]);

  if (hidden <= 0) return null;
  return (
    <button ref={sentinel} type="button" className={className} onClick={onLoadMore}>
      Mostrar mais {Math.min(hidden, pageSize)} de {hidden}
    </button>
  );
}
