'use client';

import { FileTextIcon, ImageIcon, PaperclipIcon, TrashIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, apiErrorMessage, formatBytes } from '@/lib/api';
import type { CampaignAttachment } from '@/lib/types';
import { uploadFile } from '@/lib/upload';

/**
 * Вложения рассылки.
 *
 * Фотография показывается прямо в письме, документ уходит файлом — разделение
 * ручное, потому что одну и ту же картинку прикладывают и так, и так.
 */
export function CampaignAttachments({
  campaignId,
  items,
  editable,
  channel,
  onChanged,
}: {
  campaignId: string;
  items: CampaignAttachment[];
  editable: boolean;
  channel: 'TELEGRAM' | 'EMAIL';
  onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const documentInput = useRef<HTMLInputElement>(null);

  async function attach(file: File | undefined, kind: 'PHOTO' | 'DOCUMENT') {
    if (!file) return;
    setBusy(true);
    try {
      const fileObjectId = await uploadFile(file);
      await api(`/campaigns/${campaignId}/attachments`, {
        method: 'POST',
        body: JSON.stringify({ fileObjectId, kind }),
      });
      toast.success(`«${file.name}» приложен`);
      await onChanged();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось приложить файл'));
    } finally {
      setBusy(false);
      if (photoInput.current) photoInput.current.value = '';
      if (documentInput.current) documentInput.current.value = '';
    }
  }

  async function remove(attachment: CampaignAttachment) {
    setBusy(true);
    try {
      await api(`/campaigns/${campaignId}/attachments/${attachment.id}`, { method: 'DELETE' });
      await onChanged();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось убрать вложение'));
    } finally {
      setBusy(false);
    }
  }

  if (!editable && items.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Вложения</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Пока ничего не приложено. Фотографии{' '}
            {channel === 'EMAIL' ? 'встанут в тело письма' : 'уйдут отдельным сообщением'}, документы
            — файлом.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {items.map((attachment) => (
              <li className="flex items-center gap-3 px-3 py-2" key={attachment.id}>
                {attachment.kind === 'PHOTO' ? (
                  <ImageIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <FileTextIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm">{attachment.fileName}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {formatBytes(attachment.sizeBytes)}
                </span>
                {editable ? (
                  <Button
                    aria-label={`Убрать ${attachment.fileName}`}
                    disabled={busy}
                    onClick={() => void remove(attachment)}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <TrashIcon />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {editable ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy}
                onClick={() => photoInput.current?.click()}
                size="sm"
                variant="outline"
              >
                <ImageIcon /> Фотография
              </Button>
              <Button
                disabled={busy}
                onClick={() => documentInput.current?.click()}
                size="sm"
                variant="outline"
              >
                <PaperclipIcon /> Документ
              </Button>
              {busy ? (
                <span className="self-center text-sm text-muted-foreground">
                  Загружаем и проверяем антивирусом…
                </span>
              ) : null}
            </div>
            <input
              accept="image/*"
              className="hidden"
              onChange={(event) => void attach(event.target.files?.[0], 'PHOTO')}
              ref={photoInput}
              type="file"
            />
            <input
              className="hidden"
              onChange={(event) => void attach(event.target.files?.[0], 'DOCUMENT')}
              ref={documentInput}
              type="file"
            />
            <p className="text-xs text-muted-foreground">
              До 7 МБ на файл и 10 МБ суммарно: письмо тяжелее почтовые службы начинают отбивать.
              Каждый файл проходит антивирус, поэтому появляется в списке не мгновенно.
            </p>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
