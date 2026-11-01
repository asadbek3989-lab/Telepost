import React, { useEffect, useState } from 'react';
import { Check, CheckCheck, Download, Edit3, ExternalLink, FileText, Image as ImageIcon, RefreshCw, Sparkles, X } from 'lucide-react';
import type { PostFull } from '../../shared/types';
import { sanitizeTelegramHtml } from '../../shared/telegramHtml';

interface Props {
  post: Partial<PostFull>;
  channelTitle?: string;
  channelUsername?: string;
  isEditable?: boolean;
  onTextChange?: (text: string) => void;
  onImageRemove?: () => void;
  onFileRemove?: () => void;
  onRegenerateImage?: () => void;
  busyImage?: boolean;
}

export const TelegramPostPreview: React.FC<Props> = ({
  post,
  channelTitle = 'Kanal',
  channelUsername = '',
  isEditable = false,
  onTextChange,
  onImageRemove,
  onFileRemove,
  onRegenerateImage,
  busyImage,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState(post.text || '');

  useEffect(() => {
    if (!isEditing) setEditedText(post.text || '');
  }, [post.text, isEditing]);

  const save = () => {
    onTextChange?.(editedText);
    setIsEditing(false);
  };

  const safeHtml = sanitizeTelegramHtml(post.text || '').replace(/<a /g, '<a target="_blank" rel="noreferrer noopener" ');
  const hasImageSlot = post.mediaType === 'image';
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const download = () => {
    const f = post.fileData;
    if (!f) return;
    let blob: Blob;
    if (f.content.startsWith('data:')) {
      const bin = atob(f.content.split(',')[1]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      blob = new Blob([bytes], { type: f.mimeType });
    } else blob = new Blob([f.content], { type: f.mimeType || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = f.name || 'fayl.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const fileMeta = post.fileData || post.file;

  return (
    <div className="w-full max-w-lg mx-auto bg-slate-900/90 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
      <div className="bg-[#17212b] px-4 py-3 flex items-center justify-between border-b border-[#242f3d] gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center font-bold text-white shrink-0">
            {channelTitle.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-white text-sm truncate">{channelTitle}</h3>
            <p className="text-xs text-sky-400/90 truncate">{channelUsername}</p>
          </div>
        </div>
        {isEditable && (
          <button
            onClick={() => (isEditing ? save() : setIsEditing(true))}
            className="px-2.5 py-1 text-xs font-medium rounded-lg bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 flex items-center gap-1 shrink-0"
          >
            {isEditing ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Saqlash</span>
              </>
            ) : (
              <>
                <Edit3 className="w-3.5 h-3.5" />
                <span>Tahrirlash</span>
              </>
            )}
          </button>
        )}
      </div>

      <div className="p-4 bg-[#0e1621] min-h-[220px]">
        <div className="w-full bg-[#182533] rounded-2xl overflow-hidden border border-[#2b3a4a]/40 shadow-lg text-slate-100">
          {hasImageSlot && (
            <div className="relative group bg-black/40">
              {post.imageData ? (
                <img src={post.imageData} alt="Post rasmi" className="w-full max-h-[380px] object-cover" />
              ) : (
                <div className="h-40 flex flex-col items-center justify-center gap-1 text-slate-400 text-xs bg-slate-900/60">
                  <ImageIcon className="w-7 h-7 text-sky-400" />
                  <span>Rasm Telegramda saqlangan (preview mavjud emas)</span>
                </div>
              )}
              {isEditable && (
                <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
                  {onRegenerateImage && (
                    <button
                      onClick={onRegenerateImage}
                      disabled={busyImage}
                      className="rounded-lg bg-black/70 hover:bg-sky-600 text-white text-xs flex items-center gap-1 px-2.5 py-1.5 transition disabled:opacity-60"
                    >
                      <RefreshCw className={`w-3 h-3 ${busyImage ? 'animate-spin' : ''}`} />
                      <span>Qayta chizish</span>
                    </button>
                  )}
                  {onImageRemove && (
                    <button onClick={onImageRemove} className="p-1.5 rounded-lg bg-red-600/80 hover:bg-red-700 text-white" aria-label="Rasmni olib tashlash">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {post.mediaType === 'file' && fileMeta && (
            <div className="p-3 bg-[#243343]/60 border-b border-[#2b3a4a] flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 overflow-hidden">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500 to-blue-600 flex items-center justify-center text-white shrink-0">
                  <FileText className="w-5 h-5" />
                </div>
                <div className="overflow-hidden">
                  <div className="text-sm font-semibold text-white truncate">{fileMeta.name}</div>
                  <div className="text-[11px] text-slate-300">{fileMeta.sizeBytes ? `${(fileMeta.sizeBytes / 1024).toFixed(1)} KB` : 'Hujjat'}</div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {post.fileData && (
                  <button onClick={download} className="px-2.5 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-xs flex items-center gap-1">
                    <Download className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Ko'rish</span>
                  </button>
                )}
                {isEditable && onFileRemove && (
                  <button onClick={onFileRemove} className="p-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/40 text-red-300" aria-label="Faylni olib tashlash">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="p-3.5 sm:p-4">
            {isEditing ? (
              <div className="space-y-2">
                <div className="text-xs text-sky-400 flex items-center gap-1 font-medium">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Telegram HTML: &lt;b&gt; &lt;i&gt; &lt;u&gt; &lt;s&gt; &lt;code&gt; &lt;blockquote&gt; &lt;a href&gt;</span>
                </div>
                <textarea
                  value={editedText}
                  onChange={(e) => setEditedText(e.target.value)}
                  rows={10}
                  autoFocus
                  className="w-full bg-[#121c26] text-slate-100 text-sm font-mono p-3 rounded-xl border border-sky-500/40 focus:outline-none focus:ring-2 focus:ring-sky-500 leading-relaxed resize-y"
                  placeholder="Post matnini yozing..."
                />
                <div className="flex justify-end gap-2">
                  <button onClick={() => setIsEditing(false)} className="px-3 py-1.5 text-xs text-slate-400 hover:text-white">
                    Bekor
                  </button>
                  <button onClick={save} className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-sky-500 hover:bg-sky-600 text-white flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" />
                    <span>Saqlash</span>
                  </button>
                </div>
              </div>
            ) : safeHtml ? (
              <div
                className="telegram-html-content leading-relaxed text-[15px] whitespace-pre-wrap select-text break-words"
                dangerouslySetInnerHTML={{ __html: safeHtml }}
              />
            ) : (
              <span className="text-slate-500 italic text-sm">Post matni hali yo'q...</span>
            )}

            <div className="mt-3 pt-2 border-t border-[#243343]/40 flex items-center justify-end gap-2 text-[11px] text-slate-400 select-none">
              <span>{time}</span>
              <CheckCheck className="w-4 h-4 text-sky-400" />
            </div>
          </div>

          {post.cta?.text && (
            <div className="px-3.5 pb-3.5">
              <div className="w-full py-2 px-3 rounded-xl bg-[#243343] text-sky-300 font-medium text-xs flex items-center justify-center gap-1.5 border border-[#33465b]">
                <span>{post.cta.text}</span>
                <ExternalLink className="w-3 h-3 text-sky-400" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
