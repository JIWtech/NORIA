// Captura de ponteiro pode transformar um click na imagem em click no palco.
// Exige que o gesto comece e termine no fundo, sem deslocamento.
export function shouldCloseMediaViewer(event, { moved = false, startedOnBackdrop = true } = {}) {
  return event.target === event.currentTarget && startedOnBackdrop && !moved;
}
