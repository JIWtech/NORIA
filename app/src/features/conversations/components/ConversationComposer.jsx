import React from 'react';
import {
  Bot,
  Check,
  FileText,
  Image as ImageIcon,
  Mic,
  Music2,
  Paperclip,
  Send,
  Smile,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import { formatFileSize } from '../../../utils/audioUtils.js';
import {
  EMOJI_CATEGORIES,
  formatRecordingTimer,
} from '../utils/chatTimelineHelpers.js';

export function ConversationComposer({
  activeEmojiTab,
  attachBtnRef,
  attachMenuRef,
  attachment,
  cancelAudioRecording,
  composerInputRef,
  draft = '',
  emojiBtnRef,
  emojiPickerRef,
  fileInputAccept,
  fileInputRef,
  handleFileSelected,
  handleRemoveAttachment,
  headerSubtitleInfo,
  insertEmoji,
  isAiActive,
  isRecording = false,
  recordingDuration = 0,
  sendError = null,
  sending = false,
  sendManualReply,
  setActiveEmojiTab,
  setDraft,
  setShowAttachMenu,
  setShowEmojiPicker,
  showAttachMenu = false,
  showEmojiPicker = false,
  startAudioRecording,
  stopAndSaveAudioRecording,
  triggerFileInput,
}) {
  const isAi = Boolean(headerSubtitleInfo?.isAiActive ?? isAiActive);

  return (
    <>
      <div className="composer">
        <input
          ref={fileInputRef}
          type="file"
          accept={fileInputAccept}
          style={{ display: 'none' }}
          onChange={handleFileSelected}
        />

        {/* Popover de Anexo */}
        {showAttachMenu && (
          <div className="attachment-menu-popover" ref={attachMenuRef} role="menu">
            <button
              type="button"
              className="attachment-menu-item image-opt"
              onClick={() => triggerFileInput?.('image/*,video/*', 'image')}
            >
              <span className="menu-item-icon"><ImageIcon size={14} /></span>
              <span>Fotos e Vídeos</span>
            </button>
            <button
              type="button"
              className="attachment-menu-item doc-opt"
              onClick={() => triggerFileInput?.('.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv', 'document')}
            >
              <span className="menu-item-icon"><FileText size={14} /></span>
              <span>Documento</span>
            </button>
            <button
              type="button"
              className="attachment-menu-item audio-opt"
              onClick={() => triggerFileInput?.('audio/*', 'audio')}
            >
              <span className="menu-item-icon"><Music2 size={14} /></span>
              <span>Áudio</span>
            </button>
          </div>
        )}

        {/* Popover de Emoji */}
        {showEmojiPicker && (
          <div className="emoji-picker-popover" ref={emojiPickerRef} role="dialog" aria-label="Seletor de emojis">
            <div className="emoji-categories-nav">
              {EMOJI_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  className={`emoji-cat-btn ${activeEmojiTab === cat.id ? 'active' : ''}`}
                  onClick={() => setActiveEmojiTab?.(cat.id)}
                >
                  {cat.label}
                </button>
              ))}
            </div>
            <div className="emoji-grid-container">
              {(EMOJI_CATEGORIES.find((c) => c.id === activeEmojiTab)?.emojis || []).map((emoji, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="emoji-item-btn"
                  onClick={() => insertEmoji?.(emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Card de Preview de Anexo */}
        {attachment && (
          <div className="composer-attachment-preview">
            <div className="attachment-preview-icon-wrapper">
              {attachment.category === 'image' && attachment.previewUrl ? (
                <img src={attachment.previewUrl} alt={attachment.name} className="attachment-preview-thumb" />
              ) : attachment.category === 'video' ? (
                <Video size={18} className="attachment-icon video" />
              ) : attachment.category === 'audio' ? (
                <Music2 size={18} className="attachment-icon audio" />
              ) : (
                <FileText size={18} className="attachment-icon document" />
              )}
            </div>
            <div className="attachment-preview-info">
              <span className="attachment-preview-name" title={attachment.name}>{attachment.name}</span>
              <span className="attachment-preview-size">{formatFileSize(attachment.size)}</span>
              {attachment.category === 'audio' && attachment.previewUrl && (
                <div className="attachment-preview-audio-player">
                  <audio controls src={attachment.previewUrl} className="attachment-audio-preview-player" />
                </div>
              )}
            </div>
            <button
              type="button"
              className="attachment-preview-remove"
              onClick={handleRemoveAttachment}
              title="Remover anexo"
              aria-label="Remover anexo"
            >
              <X size={15} />
            </button>
          </div>
        )}

        {isAi && !isRecording && (
          <div className="composer-ai-hint" role="status">
            <Bot size={13} aria-hidden="true" />
            <span>A IA está respondendo esta conversa. Envie uma mensagem para assumir o atendimento.</span>
          </div>
        )}

        {/* Barra de Gravação de Áudio OU Composer Normal */}
        {isRecording ? (
          <div className="composer-recording-bar">
            <div className="recording-status">
              <span className="recording-dot-pulse" aria-hidden="true" />
              <span className="recording-label">Gravando</span>
              <span className="recording-timer">{formatRecordingTimer(recordingDuration)}</span>
            </div>
            <div className="recording-waveform" aria-hidden="true">
              <span className="wave-bar bar-1" />
              <span className="wave-bar bar-2" />
              <span className="wave-bar bar-3" />
              <span className="wave-bar bar-4" />
              <span className="wave-bar bar-5" />
            </div>
            <div className="recording-actions">
              <button
                type="button"
                className="recording-cancel-btn"
                onClick={cancelAudioRecording}
                title="Cancelar gravação"
                aria-label="Cancelar gravação"
              >
                <Trash2 size={14} />
                <span>Cancelar</span>
              </button>
              <button
                type="button"
                className="recording-finish-btn"
                onClick={stopAndSaveAudioRecording}
                title="Concluir gravação"
                aria-label="Concluir gravação"
              >
                <Check size={14} />
                <span>Concluir</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="composer-main-row">
            <div className="composer-left-actions">
              <button
                ref={attachBtnRef}
                type="button"
                className={`composer-icon-btn ${showAttachMenu ? 'active' : ''}`}
                disabled
                title="Anexar arquivo — em breve"
                aria-label="Anexar arquivo — em breve"
              >
                <Paperclip size={18} />
              </button>
              <button
                ref={emojiBtnRef}
                type="button"
                className={`composer-icon-btn ${showEmojiPicker ? 'active' : ''}`}
                onClick={() => setShowEmojiPicker?.((prev) => !prev)}
                title="Inserir emoji"
                aria-label="Inserir emoji"
              >
                <Smile size={18} />
              </button>
            </div>
            <div className="composer-input-wrapper">
              <textarea
                ref={composerInputRef}
                className="composer-textarea"
                placeholder="Digite uma mensagem..."
                rows={1}
                value={draft}
                onChange={(event) => {
                  setDraft?.(event.target.value);
                  if (event?.target?.style) {
                    event.target.style.height = 'auto';
                    event.target.style.height = `${Math.min(event.target.scrollHeight, 120)}px`;
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault?.();
                    sendManualReply?.();
                  }
                }}
              />
            </div>
            <div className="composer-right-actions">
              <button
                type="button"
                className="composer-icon-btn mic-btn"
                disabled
                title="Gravar áudio — em breve"
                aria-label="Gravar áudio — em breve"
              >
                <Mic size={18} />
              </button>
              <button
                className="primary-button composer-send-btn"
                type="button"
                onClick={sendManualReply}
                disabled={sending || (!draft.trim() && !attachment)}
                aria-label="Enviar mensagem"
              >
                <Send size={15} />
                <span className="composer-send-text">{sending ? 'Enviando...' : 'Enviar'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
      {sendError && <div className="inline-error">{sendError}</div>}
    </>
  );
}
