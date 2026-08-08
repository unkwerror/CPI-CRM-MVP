'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { api, apiErrorMessage } from '@/lib/api';
import type { Campaign, CampaignChannel } from '@/lib/types';

const STARTER_BODY = `Здравствуйте, {{имя}}!

Это стартап-студия ЦПИ. Вы участвовали в наших мероприятиях — рассказываем, что происходит сейчас.

Открыт приём заявок на конкурс стартапов. Если тема близка, нажмите кнопку ниже, и мы пришлём условия.`;

export function CampaignCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => Promise<void> | void;
}) {
  const router = useRouter();
  const [channel, setChannel] = useState<CampaignChannel>('TELEGRAM');
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState(STARTER_BODY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setChannel('TELEGRAM');
    setName('');
    setGoal('');
    setSubject('');
    setBody(STARTER_BODY);
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim().length < 3) {
      toast.error('Дайте рассылке понятное название');
      return;
    }
    if (channel === 'EMAIL' && !subject.trim()) {
      toast.error('У письма должна быть тема');
      return;
    }
    setSaving(true);
    try {
      const created = await api<Campaign>('/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          channel,
          goal: goal.trim() || undefined,
          subject: channel === 'EMAIL' ? subject.trim() : undefined,
          body,
        }),
      });
      toast.success('Черновик создан');
      onOpenChange(false);
      await onCreated();
      router.push(`/campaigns/${created.id}`);
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось создать рассылку'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Новая рассылка</DialogTitle>
            <DialogDescription>
              Текст можно будет править до утверждения. В сообщении доступны подстановки{' '}
              {'{{имя}}'} и {'{{фио}}'}.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <Tabs onValueChange={(value) => setChannel(value as CampaignChannel)} value={channel}>
              <TabsList>
                <TabsTrigger value="TELEGRAM">Telegram-бот</TabsTrigger>
                <TabsTrigger value="EMAIL">Email</TabsTrigger>
              </TabsList>
            </Tabs>
            <p className="text-sm text-muted-foreground">
              {channel === 'TELEGRAM'
                ? 'Бот пишет только тем, кто сам нажал /start. Участникам, от которых остался лишь @ник, сообщение не уйдёт.'
                : 'Письмо уходит всем, у кого есть адрес и нет отписки. Начните с небольшой волны, чтобы не испортить репутацию домена.'}
            </p>

            <div className="space-y-2">
              <Label htmlFor="campaign-name">Название</Label>
              <Input
                id="campaign-name"
                onChange={(event) => setName(event.target.value)}
                placeholder="Приглашение на конкурс стартапов"
                value={name}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="campaign-goal">Цель</Label>
              <Input
                id="campaign-goal"
                onChange={(event) => setGoal(event.target.value)}
                placeholder="Собрать заявки на конкурс и почистить базу от отписок"
                value={goal}
              />
            </div>

            {channel === 'EMAIL' ? (
              <div className="space-y-2">
                <Label htmlFor="campaign-subject">Тема письма</Label>
                <Input
                  id="campaign-subject"
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder="Конкурс стартапов: приём заявок открыт"
                  value={subject}
                />
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="campaign-body">Сообщение</Label>
              <Textarea
                id="campaign-body"
                onChange={(event) => setBody(event.target.value)}
                rows={10}
                value={body}
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)} type="button" variant="ghost">
              Отмена
            </Button>
            <Button disabled={saving} type="submit">
              Создать черновик
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
